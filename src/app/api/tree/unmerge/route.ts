import { NextRequest, NextResponse } from "next/server";
import { getWorkspace, saveWorkspace } from "@/lib/workspace-store";

/**
 * POST /api/tree/unmerge
 *
 * Reverse a merge: restore the source fragments' original contents
 * (popped from previousVersions which the merge endpoint stashed
 * before overwriting), put them back into sequence at roughly their
 * original positions (using the preMergeSnapshot in the opLog), and
 * delete the merged fragment along with its derivation edges.
 *
 * Body: { treeId, mergedId }
 * Returns: { ok, restoredIds }
 */
export async function POST(req: NextRequest) {
  const { treeId, mergedId } = (await req.json()) as {
    treeId: string;
    mergedId: string;
  };

  if (!treeId || !mergedId) {
    return NextResponse.json(
      { error: "Missing required fields: treeId, mergedId" },
      { status: 400 }
    );
  }

  const ws = getWorkspace(treeId);
  if (!ws) return NextResponse.json({ error: "Tree not found" }, { status: 404 });

  const mergedFrag = ws.fragments[mergedId];
  if (!mergedFrag) {
    return NextResponse.json({ error: "Merged fragment not found" }, { status: 404 });
  }
  if (mergedFrag.provenance.type !== "merged") {
    return NextResponse.json({ error: "Fragment is not a merged result" }, { status: 400 });
  }

  const sourceIds = mergedFrag.provenance.sourceFragmentIds ?? [];
  if (sourceIds.length === 0) {
    return NextResponse.json({ error: "No source fragments to restore" }, { status: 400 });
  }

  // Find the most recent merge operation in the opLog matching this resultId.
  // It carries the pre-merge sequence snapshot.
  let snapshot: Extract<typeof ws.opLog[number], { type: "merge" }>["preMergeSnapshot"] = undefined;
  for (let i = ws.opLog.length - 1; i >= 0; i--) {
    const op = ws.opLog[i];
    if (op.type === "merge" && op.resultId === mergedId) {
      snapshot = op.preMergeSnapshot;
      break;
    }
  }

  // Restore each source fragment's content from its previousVersions stash.
  // The merge endpoint pushed the original content there before overwrite.
  const restored: string[] = [];
  for (const sid of sourceIds) {
    const src = ws.fragments[sid];
    if (!src) continue;
    if (src.previousVersions.length > 0) {
      src.content = src.previousVersions.pop()!;
      src.status = "complete";
      restored.push(sid);
    }
  }

  // Restore sequence: replace mergedId with the source ids that were
  // originally there. If both sources were in sequence, insert them in
  // their original order using preSourceSeqIdx / preTargetSeqIdx as
  // hints (clamped to current sequence length).
  const mergedSeqIdx = ws.sequence.indexOf(mergedId);
  if (mergedSeqIdx !== -1) {
    const replacements: string[] = [];
    if (snapshot) {
      // Order by recorded original indices (smaller idx first)
      const ordered = [...sourceIds].sort((a, b) => {
        const idxA =
          a === sourceIds[0] ? snapshot.preSourceSeqIdx : snapshot.preTargetSeqIdx;
        const idxB =
          b === sourceIds[0] ? snapshot.preSourceSeqIdx : snapshot.preTargetSeqIdx;
        return idxA - idxB;
      });
      for (const id of ordered) {
        const wasInSeq =
          (id === sourceIds[0] && snapshot.sourceWasInSequence) ||
          (id === sourceIds[1] && snapshot.targetWasInSequence);
        if (wasInSeq && ws.fragments[id]) replacements.push(id);
      }
    } else {
      // No snapshot — just put both back
      for (const id of sourceIds) {
        if (ws.fragments[id]) replacements.push(id);
      }
    }
    ws.sequence.splice(mergedSeqIdx, 1, ...replacements);
  }

  // Restore stage entries
  const mergedStageIdx = ws.stageIds.indexOf(mergedId);
  if (mergedStageIdx !== -1) {
    const replacements: string[] = [];
    if (snapshot) {
      for (const id of sourceIds) {
        const wasInStage =
          (id === sourceIds[0] && snapshot.sourceWasInStage) ||
          (id === sourceIds[1] && snapshot.targetWasInStage);
        if (wasInStage && ws.fragments[id]) replacements.push(id);
      }
    }
    ws.stageIds.splice(mergedStageIdx, 1, ...replacements);
  }

  // Remove merged fragment, its edges, and its canvas position.
  delete ws.fragments[mergedId];
  ws.edges = ws.edges.filter((e) => e.from !== mergedId && e.to !== mergedId);
  delete ws.canvasPositions[mergedId];

  ws.opLog.push({
    type: "unmerge",
    mergedId,
    restoredIds: restored,
    timestamp: new Date().toISOString(),
  });

  saveWorkspace(ws);

  console.log(
    `[unmerge] restored ${restored.length} fragments from merged ${mergedId.slice(0, 8)}`
  );

  return NextResponse.json({ ok: true, restoredIds: restored });
}
