import { NextRequest, NextResponse } from "next/server";
import { getWorkspace, saveWorkspace } from "@/lib/workspace-store";
import { addFragment, addEdge, appendToSequence, updateFragmentContent } from "@/lib/workspace";
import { queryClaudeCode } from "@/lib/claude";

const EXPAND_SYSTEM_PROMPT = `You are an expansion engine. You do NOT ask questions. You do NOT narrow. You do NOT summarize into a framework.

Your job is to WIDEN the thought-space. Given freeform writing, you:

1. EXTRACT THREADS — identify distinct lines of thought, name each one in 3-5 words. Do not merge them. Do not rank them. List them as parallel possibilities.

2. SURFACE TENSIONS — find places where two ideas in the text pull against each other, or where an unstated assumption is load-bearing. Name the tension without resolving it.

3. PROPOSE METAPHORS — offer 2-3 fresh metaphors or analogies that resonate with the material but come from unexpected domains. Do not explain why they fit. Just offer them.

4. ECHO BACK IMAGES — if the writing contains vivid imagery or felt sense, reflect those images back in slightly different language. Not interpretation. Resonance.

Format: Use short paragraphs, no bullet lists, no headers, no numbered items. Write in fragments if that's what the material calls for. Match the energy and register of the input — if it's raw and searching, be raw and searching back. If it's precise, be precise.

CRITICAL: Do not reify. Do not collapse the ambiguity into a plan. Do not ask "what do you mean by X?" The writer knows what they mean. Your job is to make the space bigger, not smaller.`;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { treeId, mode } = body as {
    treeId: string;
    mode?: "threads" | "tensions" | "metaphors" | "full";
  };

  const ws = getWorkspace(treeId);
  if (!ws) {
    return NextResponse.json({ error: "Tree not found" }, { status: 404 });
  }

  // Gather all human-typed text from the sequence
  const userText = ws.sequence
    .map((id) => ws.fragments[id])
    .filter((f) => f && f.provenance.type === "human-typed" && f.content)
    .map((f) => f.content)
    .join("\n\n---\n\n");

  if (!userText.trim()) {
    return NextResponse.json({ error: "No text to expand" }, { status: 400 });
  }

  const modePrompt = mode === "threads"
    ? "Focus only on extracting threads — the distinct lines of thought in this writing."
    : mode === "tensions"
      ? "Focus only on surfacing tensions — the contradictions, unstated assumptions, load-bearing beliefs."
      : mode === "metaphors"
        ? "Focus only on proposing fresh metaphors and analogies from unexpected domains."
        : "Do all four: extract threads, surface tensions, propose metaphors, echo back images.";

  const prompt = `${modePrompt}\n\nHere is the writing:\n\n${userText}`;

  const lastFragId = ws.sequence[ws.sequence.length - 1];
  const expansionFrag = addFragment(ws, "", { type: "ai-generated", model: ws.settings.model }, "generating");
  addEdge(ws, lastFragId, expansionFrag.id, "responded-to");
  appendToSequence(ws, expansionFrag.id);
  saveWorkspace(ws);

  const model = ws.settings.model || process.env.VIVEKA_MODEL || "sonnet";
  const startMs = Date.now();

  queryClaudeCode(prompt, EXPAND_SYSTEM_PROMPT, [], { model, noTools: true })
    .then((response) => {
      const freshWs = getWorkspace(treeId);
      if (freshWs && freshWs.fragments[expansionFrag.id]) {
        updateFragmentContent(freshWs, expansionFrag.id, response.text);
        freshWs.fragments[expansionFrag.id].provenance.model = model;
        freshWs.fragments[expansionFrag.id].timing = {
          startedAt: new Date(startMs).toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startMs,
        };
        saveWorkspace(freshWs);
        console.log(`[expand] done in ${Date.now() - startMs}ms`);
      }
    })
    .catch((err) => {
      const freshWs = getWorkspace(treeId);
      if (freshWs && freshWs.fragments[expansionFrag.id]) {
        freshWs.fragments[expansionFrag.id].status = "error";
        freshWs.fragments[expansionFrag.id].error = String(err);
        saveWorkspace(freshWs);
      }
    });

  return NextResponse.json({
    nodeId: expansionFrag.id,
    status: "generating",
  });
}
