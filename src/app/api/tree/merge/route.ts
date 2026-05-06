import { NextRequest, NextResponse } from "next/server";
import { getWorkspace, saveWorkspace } from "@/lib/workspace-store";
import { mergeFragments, updateFragmentContent } from "@/lib/workspace";
import { queryClaudeCode } from "@/lib/claude";

type MergeType = "prepend" | "append" | "interleave" | "summarize";

const MERGE_SYSTEM_PROMPT = `You are merging two text fragments into a single coherent piece. Output only the merged text, no commentary, no preamble.`;

function buildMergePrompt(
  sourceContent: string,
  targetContent: string,
  mergeType: MergeType,
): string {
  const instructions: Record<MergeType, string> = {
    prepend: "Fragment A comes before Fragment B. Lightly edit for flow and coherence.",
    append: "Fragment B comes after Fragment A. Lightly edit for flow and coherence.",
    interleave: "Weave sentences from both fragments together thematically, preserving key ideas from each.",
    summarize: "Distill both fragments into a shorter synthesis that captures the essential meaning of both.",
  };

  return `Merge type: ${mergeType}
Instructions: ${instructions[mergeType]}

--- Fragment A (source, being dragged) ---
${sourceContent}

--- Fragment B (target, receiving) ---
${targetContent}

Produce the merged text:`;
}

export async function POST(req: NextRequest) {
  const { treeId, sourceId, targetId, mergeType } = await req.json() as {
    treeId: string;
    sourceId: string;
    targetId: string;
    mergeType: MergeType;
  };

  console.log(`[merge] request: treeId=${treeId?.slice(0, 8)} source=${sourceId?.slice(0, 8)} target=${targetId?.slice(0, 8)} type=${mergeType}`);

  const ws = getWorkspace(treeId);
  if (!ws) return NextResponse.json({ error: "Tree not found" }, { status: 404 });

  const result = mergeFragments(ws, sourceId, targetId);
  if (!result) {
    return NextResponse.json({ error: "Fragment not found" }, { status: 404 });
  }
  const { mergedFrag, sourceContent, targetContent } = result;

  saveWorkspace(ws);

  // Fire LLM call (don't await).
  const startedAt = mergedFrag.timing!.startedAt;
  const startMs = Date.now();
  const prompt = buildMergePrompt(sourceContent, targetContent, mergeType);

  queryClaudeCode(prompt, MERGE_SYSTEM_PROMPT, [], { noTools: true })
    .then((response) => {
      const durationMs = Date.now() - startMs;
      const freshWs = getWorkspace(treeId);
      if (freshWs && freshWs.fragments[mergedFrag.id]) {
        updateFragmentContent(freshWs, mergedFrag.id, response.text);
        freshWs.fragments[mergedFrag.id].timing = {
          startedAt,
          completedAt: new Date().toISOString(),
          durationMs,
        };
        saveWorkspace(freshWs);
        console.log(`[merge] DONE in ${durationMs}ms | ${response.text.length} chars | type=${mergeType}`);
      }
    })
    .catch((err) => {
      const durationMs = Date.now() - startMs;
      console.error(`[merge] FAILED in ${durationMs}ms:`, err instanceof Error ? err.message : err);
      const freshWs = getWorkspace(treeId);
      if (freshWs && freshWs.fragments[mergedFrag.id]) {
        freshWs.fragments[mergedFrag.id].status = "error";
        freshWs.fragments[mergedFrag.id].error = err instanceof Error ? err.message : String(err);
        freshWs.fragments[mergedFrag.id].timing = {
          startedAt,
          completedAt: new Date().toISOString(),
          durationMs,
        };
        saveWorkspace(freshWs);
      }
    });

  return NextResponse.json({
    resultId: mergedFrag.id,
    status: "generating",
  });
}
