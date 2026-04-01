import { NextRequest, NextResponse } from "next/server";
import { getWorkspace, saveWorkspace } from "@/lib/workspace-store";
import {
  addFragment,
  addEdge,
  appendToSequence,
  updateFragmentContent,
  getConversationHistory,
} from "@/lib/workspace";
import { queryClaudeCode } from "@/lib/claude";
import { buildSystemPrompt } from "@/lib/system-prompt";
import { Session } from "@/lib/types";

/**
 * Generate N assistant completions for a given parent fragment.
 * Fires N parallel LLM calls and returns immediately with pending fragment IDs.
 * Completions fill in lazily (poll /api/tree/get to see updates).
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { treeId, parentId, count, userMessage } = body as {
    treeId: string;
    parentId: string;
    count?: number;
    userMessage?: string;
  };

  console.log(`[generate] request: treeId=${treeId?.slice(0, 8)} parentId=${parentId?.slice(0, 8)} count=${count} userMsg=${userMessage ? userMessage.slice(0, 50) + "..." : "none"}`);

  const ws = getWorkspace(treeId);
  if (!ws) return NextResponse.json({ error: "Tree not found" }, { status: 404 });

  // If userMessage provided, create user fragment first
  let actualParentId = parentId;
  if (userMessage) {
    const userFrag = addFragment(ws, userMessage, { type: "human-typed" });
    addEdge(ws, parentId, userFrag.id, "responded-to");
    appendToSequence(ws, userFrag.id);
    actualParentId = userFrag.id;
    saveWorkspace(ws);
  }

  const parentFrag = ws.fragments[actualParentId];
  if (!parentFrag) return NextResponse.json({ error: "Parent not found" }, { status: 404 });

  const n = count ?? ws.settings.rerollCount;

  // Create pending fragments
  const pendingFragments: string[] = [];
  for (let i = 0; i < n; i++) {
    const f = addFragment(ws, "", { type: "ai-generated", model: ws.settings.model }, "generating");
    addEdge(ws, actualParentId, f.id, "responded-to");
    pendingFragments.push(f.id);
  }
  saveWorkspace(ws);

  // Build context
  const history = getConversationHistory(ws);
  const stubSession: Session = {
    id: ws.id,
    createdAt: ws.createdAt,
    intent: ws.intent,
    completionCondition: ws.completionCondition,
    mode: ws.mode as Session["mode"],
    budget: 999,
    exchanges: [],
    status: "active",
    completionMet: null,
    contextBlocks: [],
    excludedExchanges: [],
    interventionLog: [],
  };
  const systemPrompt = buildSystemPrompt(stubSession);
  const model = ws.settings.model || process.env.VIVEKA_MODEL || "sonnet";
  const promptMessage = parentFrag.provenance.type === "human-typed" ? parentFrag.content : "";

  const historyTokenEst = history.reduce((s, h) => s + h.content.length, 0);
  console.log(`[generate] firing ${n} parallel completions | model=${model} | history=${history.length} msgs (~${historyTokenEst} chars) | prompt="${promptMessage.slice(0, 80)}..."`);

  // Fire N parallel completions (don't await)
  Promise.all(
    pendingFragments.map(async (fragId, i) => {
      const startedAt = new Date().toISOString();
      const startMs = Date.now();
      console.log(`[generate] completion ${i + 1}/${n} (${fragId.slice(0, 8)}) starting...`);
      try {
        const response = await queryClaudeCode(
          promptMessage,
          systemPrompt,
          history.slice(0, -1),
          { model, noTools: true }
        );

        const durationMs = Date.now() - startMs;
        const freshWs = getWorkspace(treeId);
        if (freshWs && freshWs.fragments[fragId]) {
          updateFragmentContent(freshWs, fragId, response.text);
          freshWs.fragments[fragId].provenance.model = model;
          freshWs.fragments[fragId].timing = {
            startedAt,
            completedAt: new Date().toISOString(),
            durationMs,
          };
          // Add first successful completion to sequence
          const anyInSeq = pendingFragments.some((pid) => freshWs.sequence.includes(pid));
          if (!anyInSeq) {
            appendToSequence(freshWs, fragId);
          }
          saveWorkspace(freshWs);
          console.log(`[generate] completion ${i + 1}/${n} (${fragId.slice(0, 8)}) DONE in ${durationMs}ms | ${response.text.length} chars | tokens: in=${response.usage?.inputTokens ?? "?"} out=${response.usage?.outputTokens ?? "?"}`);
        }
      } catch (err) {
        const durationMs = Date.now() - startMs;
        console.error(`[generate] completion ${i + 1}/${n} (${fragId.slice(0, 8)}) FAILED in ${durationMs}ms:`, err instanceof Error ? err.message : err);
        const freshWs = getWorkspace(treeId);
        if (freshWs && freshWs.fragments[fragId]) {
          freshWs.fragments[fragId].status = "error";
          freshWs.fragments[fragId].error = err instanceof Error ? err.message : String(err);
          freshWs.fragments[fragId].timing = {
            startedAt,
            completedAt: new Date().toISOString(),
            durationMs,
          };
          saveWorkspace(freshWs);
        }
      }
    })
  ).then(() => {
    console.log(`[generate] all ${n} completions finished for parent ${actualParentId.slice(0, 8)}`);
  });

  return NextResponse.json({
    nodeIds: pendingFragments,
    status: "generating",
    message: `${n} completions started`,
  });
}
