"use client";

import { useEffect, useMemo, type Dispatch, type SetStateAction } from "react";
import type { Workspace } from "@/lib/workspace";
import {
  computeMergeIntent,
  type MergeType,
  type Position,
  type Size,
} from "@/lib/canvas-geometry";

export interface MergeCandidate {
  draggedId: string;
  targetId: string;
  angle: number;
  /** Cardinal-angle classification at detection time. The LIVE
   *  mergeIntent below overrides this for rendering and commit. */
  mergeType: MergeType;
  startedAt: number;
  confirmed: boolean;
  /** Set after the merge API returns + the result fragment exists.
   *  Keeps MergePreview rendering through the LLM call so the
   *  deformation doesn't hard-cut to a blank placeholder. The
   *  status-watcher effect clears the whole candidate when the
   *  merged fragment finishes generating. */
  mergedFragId?: string;
}

export interface MergeIntent {
  mergeType: MergeType;
  insertOffset?: number;
}

/**
 * useMergeFlow — owns the side-effects of the merge gesture state
 * machine. The state itself stays in the caller (so physics-detection
 * callbacks can write to it without a circular dep on positions).
 *
 *   detection (caller's physics callback writes mergeCandidate)
 *     → hold (this hook's timer effect flips confirmed=true after holdMs)
 *     → fire (this hook's API effect dispatches /api/tree/merge,
 *             stashes mergedFragId on the candidate)
 *     → LLM running (MergePreview keeps rendering because candidate
 *             is still alive — but no longer firing the hold timer)
 *     → done (this hook's status-watcher clears the candidate when
 *             the merged fragment's status flips to complete/error)
 *
 * Returns the live position-derived `mergeIntent` (which mode + which
 * insert offset). The caller passes this into MergePreview/Spinner
 * to render and uses it on commit so live re-aim during the hold
 * wins over the cardinal-angle classification stored at detection.
 */
export function useMergeFlow(args: {
  ws: Workspace;
  positions: Record<string, Position>;
  physicsNodeSize: (id: string) => Size;
  holdMs: number;
  killNode: (id: string) => void;
  onRefresh: () => void;
  mergeCandidate: MergeCandidate | null;
  setMergeCandidate: Dispatch<SetStateAction<MergeCandidate | null>>;
}): { mergeIntent: MergeIntent | null } {
  const {
    ws,
    positions,
    physicsNodeSize,
    holdMs,
    killNode,
    onRefresh,
    mergeCandidate,
    setMergeCandidate,
  } = args;

  // Live position-derived mode + insert offset. Updates as the writer
  // wiggles the dragged fragment over the target during the hold.
  const mergeIntent = useMemo<MergeIntent | null>(() => {
    if (!mergeCandidate) return null;
    const draggedPos = positions[mergeCandidate.draggedId];
    const targetPos = positions[mergeCandidate.targetId];
    if (!draggedPos || !targetPos) return null;
    const targetFrag = ws.fragments[mergeCandidate.targetId];
    return computeMergeIntent({
      draggedPos,
      draggedSize: physicsNodeSize(mergeCandidate.draggedId),
      targetPos,
      targetSize: physicsNodeSize(mergeCandidate.targetId),
      targetContent: targetFrag?.content ?? "",
    });
  }, [mergeCandidate, positions, physicsNodeSize, ws.fragments]);

  // Hold-confirm timer.
  useEffect(() => {
    if (!mergeCandidate || mergeCandidate.confirmed) return;
    const elapsed = Date.now() - mergeCandidate.startedAt;
    const remaining = holdMs - elapsed;
    if (remaining <= 0) {
      setMergeCandidate((prev) => (prev ? { ...prev, confirmed: true } : null));
      return;
    }
    const id = setTimeout(() => {
      setMergeCandidate((prev) => (prev ? { ...prev, confirmed: true } : null));
    }, remaining);
    return () => clearTimeout(id);
  }, [mergeCandidate, holdMs, setMergeCandidate]);

  // Fire merge API on confirm. Uses LIVE mergeIntent so the writer's
  // last position before confirm wins. Crucially: does NOT clear
  // mergeCandidate in .then() — that would unmount MergePreview the
  // moment the API responds. Instead, stash mergedFragId so the
  // watcher below clears once the merged fragment's status finishes.
  useEffect(() => {
    if (!mergeCandidate?.confirmed || mergeCandidate.mergedFragId) return;
    const { draggedId, targetId } = mergeCandidate;
    const liveType = mergeIntent?.mergeType ?? mergeCandidate.mergeType;
    const insertOffset = mergeIntent?.insertOffset;
    fetch("/api/tree/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        treeId: ws.id,
        sourceId: draggedId,
        targetId,
        mergeType: liveType,
        insertOffset,
      }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        killNode(draggedId);
        if (data && data.resultId) {
          setMergeCandidate((prev) =>
            prev ? { ...prev, mergedFragId: data.resultId } : prev,
          );
        } else {
          setMergeCandidate(null);
        }
        onRefresh();
      })
      .catch(() => {
        setMergeCandidate(null);
      });
  }, [
    mergeCandidate?.confirmed,
    mergeCandidate?.mergedFragId,
    mergeIntent,
    ws.id,
    killNode,
    onRefresh,
    setMergeCandidate,
  ]);

  // Clear mergeCandidate when the merged fragment finishes generating.
  useEffect(() => {
    if (!mergeCandidate?.mergedFragId) return;
    const merged = ws.fragments[mergeCandidate.mergedFragId];
    if (!merged) return;
    if (merged.status === "complete" || merged.status === "error") {
      setMergeCandidate(null);
    }
  }, [mergeCandidate?.mergedFragId, ws.fragments, setMergeCandidate]);

  return { mergeIntent };
}
