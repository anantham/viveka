import { NextRequest, NextResponse } from "next/server";
import { getWorkspace, saveWorkspace } from "@/lib/workspace-store";
import { addFragment, addEdge, updateFragmentContent, getConversationHistory } from "@/lib/workspace";
import { queryClaudeCode } from "@/lib/claude";

/**
 * Generate N draft user replies.
 * The AI suggests what the user might say next.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { treeId, parentId, count } = body as {
    treeId: string;
    parentId: string;
    count?: number;
  };

  const ws = getWorkspace(treeId);
  if (!ws) return NextResponse.json({ error: "Tree not found" }, { status: 404 });
  if (!ws.fragments[parentId]) return NextResponse.json({ error: "Parent not found" }, { status: 404 });

  const n = count ?? ws.settings.draftCount;

  // Create pending draft fragments
  const pendingIds: string[] = [];
  for (let i = 0; i < n; i++) {
    const f = addFragment(ws, "", { type: "ai-generated", model: ws.settings.model }, "generating");
    addEdge(ws, parentId, f.id, "responded-to");
    pendingIds.push(f.id);
  }
  saveWorkspace(ws);

  const history = getConversationHistory(ws);
  const model = ws.settings.model || process.env.VIVEKA_MODEL || "sonnet";

  // Capture the prompt template once for the opLog (each draft uses
  // the same template with a different draft-index marker).
  const promptTemplate = `Given this conversation, suggest what the user might say next. Each draft should explore a DIFFERENT direction or angle. The session intent is: "${ws.intent}".

Return ONLY the suggested user message, nothing else.`;
  const draftStartedAt = new Date().toISOString();
  const draftStartMs = Date.now();

  Promise.all(
    pendingIds.map(async (fragId, i) => {
      const draftPrompt = `Given this conversation, suggest what the user might say next. This is draft ${i + 1} of ${n} — each draft should explore a DIFFERENT direction or angle. The session intent is: "${ws.intent}".

Return ONLY the suggested user message, nothing else. No quotes, no explanation, no "The user might say:" prefix. Just the raw message text as if the user typed it.`;

      const startedAt = new Date().toISOString();
      const startMs = Date.now();
      try {
        const response = await queryClaudeCode(
          draftPrompt,
          "You generate diverse draft user messages for conversations. Each draft should be distinct in approach, tone, or direction. Output only the draft message text.",
          history,
          { model, noTools: true }
        );

        const durationMs = Date.now() - startMs;
        const freshWs = getWorkspace(treeId);
        if (freshWs && freshWs.fragments[fragId]) {
          updateFragmentContent(freshWs, fragId, response.text);
          freshWs.fragments[fragId].timing = { startedAt, completedAt: new Date().toISOString(), durationMs };
          saveWorkspace(freshWs);
          console.log(`[draft] ${fragId.slice(0, 8)} done in ${durationMs}ms`);
        }
      } catch (err) {
        const durationMs = Date.now() - startMs;
        const freshWs = getWorkspace(treeId);
        if (freshWs && freshWs.fragments[fragId]) {
          freshWs.fragments[fragId].status = "error";
          freshWs.fragments[fragId].error = err instanceof Error ? err.message : String(err);
          freshWs.fragments[fragId].timing = { startedAt, completedAt: new Date().toISOString(), durationMs };
          saveWorkspace(freshWs);
        }
      }
    })
  ).then(() => {
    // Single draft op summarizing the batch — the X-ray sees one
    // "draft" entry per click of "draft replies" rather than N noisy
    // ai-gen entries. Each individual draft already exists as a
    // fragment; the op preserves the prompt + model + fragment list.
    const finalWs = getWorkspace(treeId);
    if (finalWs) {
      finalWs.opLog.push({
        type: "draft",
        parentId,
        resultIds: pendingIds,
        model,
        timestamp: draftStartedAt,
        prompt: promptTemplate,
        durationMs: Date.now() - draftStartMs,
      });
      saveWorkspace(finalWs);
    }
    console.log(`[draft] ${n} drafts done for ${parentId.slice(0, 8)}`);
  });

  return NextResponse.json({ nodeIds: pendingIds, status: "generating", message: `${n} drafts started` });
}
