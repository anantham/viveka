import { NextRequest, NextResponse } from "next/server";
import { getWorkspace, saveWorkspace } from "@/lib/workspace-store";
import {
  addFragment,
  addEdge,
  updateFragmentContent,
} from "@/lib/workspace";
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

  const sourceFrag = ws.fragments[sourceId];
  const targetFrag = ws.fragments[targetId];
  if (!sourceFrag || !targetFrag) {
    return NextResponse.json({ error: "Fragment not found" }, { status: 404 });
  }
  const sourceContent = sourceFrag.content;
  const targetContent = targetFrag.content;

  // Create pending merged fragment. Mark timing.startedAt eagerly so the
  // frontend can show a live countdown on the still-generating fragment
  // until Claude's response arrives.
  const startedAtIso = new Date().toISOString();
  const mergedFrag = addFragment(ws, "", {
    type: "merged",
    sourceFragmentIds: [sourceId, targetId],
  }, "generating");
  mergedFrag.timing = { startedAt: startedAtIso, completedAt: "", durationMs: 0 };

  // Add derivation edges
  addEdge(ws, sourceId, mergedFrag.id, "derived");
  addEdge(ws, targetId, mergedFrag.id, "derived");

  const targetInSequence = ws.sequence.includes(targetId);
  const targetInStage = ws.stageIds.includes(targetId);
  const sourceInSequence = ws.sequence.includes(sourceId);
  const sourceInStage = ws.stageIds.includes(sourceId);

  const nextSequence: string[] = [];
  for (const id of ws.sequence) {
    if (id === targetId) {
      nextSequence.push(mergedFrag.id);
      continue;
    }
    if (id === sourceId) {
      if (!targetInSequence && !targetInStage && sourceInSequence) {
        nextSequence.push(mergedFrag.id);
      }
      continue;
    }
    nextSequence.push(id);
  }

  const nextStageIds: string[] = [];
  for (const id of ws.stageIds) {
    if (id === targetId) {
      nextStageIds.push(mergedFrag.id);
      continue;
    }
    if (id === sourceId) {
      if (!targetInSequence && !targetInStage && sourceInStage) {
        nextStageIds.push(mergedFrag.id);
      }
      continue;
    }
    nextStageIds.push(id);
  }

  if (!targetInSequence && !targetInStage && !sourceInSequence && !sourceInStage) {
    nextSequence.push(mergedFrag.id);
  }

  ws.sequence = nextSequence;
  ws.stageIds = nextStageIds;

  // Inherit target's canvas position
  if (ws.canvasPositions[targetId]) {
    ws.canvasPositions[mergedFrag.id] = { ...ws.canvasPositions[targetId] };
  } else if (ws.canvasPositions[sourceId]) {
    ws.canvasPositions[mergedFrag.id] = { ...ws.canvasPositions[sourceId] };
  }
  delete ws.canvasPositions[sourceId];
  delete ws.canvasPositions[targetId];

  // Hide both input fragments after the merge while keeping lineage via derived edges.
  // Stash originals in previousVersions so an unmerge endpoint can restore them.
  sourceFrag.previousVersions.push(sourceFrag.content);
  targetFrag.previousVersions.push(targetFrag.content);
  sourceFrag.status = "pending";
  sourceFrag.content = `[merged into ${mergedFrag.id}]`;
  targetFrag.status = "pending";
  targetFrag.content = `[merged into ${mergedFrag.id}]`;

  // Log operation. Capture pre-merge sequence indices so unmerge can
  // attempt to restore originals to roughly where they came from.
  const preSourceSeqIdx = ws.sequence.indexOf(sourceId);
  const preTargetSeqIdx = ws.sequence.indexOf(targetId);
  ws.opLog.push({
    type: "merge",
    sourceIds: [sourceId, targetId],
    resultId: mergedFrag.id,
    timestamp: startedAtIso,
    // for undo
    preMergeSnapshot: {
      sourceWasInSequence: sourceInSequence,
      targetWasInSequence: targetInSequence,
      sourceWasInStage: sourceInStage,
      targetWasInStage: targetInStage,
      preSourceSeqIdx,
      preTargetSeqIdx,
    },
  });

  saveWorkspace(ws);

  // Fire LLM call (don't await)
  const startedAt = new Date().toISOString();
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
