/**
 * Workspace data model — three independent structures.
 *
 * 1. Fragments: the atoms of content
 * 2. Edges: generative history (append-only)
 * 3. Sequence: reading order (mutable)
 *
 * Operations are the single coordination point.
 * Views are pure projections.
 */

import { v4 as uuidv4 } from "uuid";

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

export interface GenerationParams {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  repetition_penalty?: number;
  min_p?: number;
  top_a?: number;
  seed?: number;
  max_tokens?: number;
  stop?: string[];
}

export interface Provenance {
  type: "human-typed" | "ai-generated" | "split" | "extracted" | "imported" | "merged" | "derived" | "system";
  model?: string;
  prompt?: string;
  params?: GenerationParams;
  snapshotId?: string;
  sourceFragmentIds?: string[];
  sourceRef?: string;
}

// ---------------------------------------------------------------------------
// Fragment
// ---------------------------------------------------------------------------

export interface Fragment {
  id: string;
  content: string;
  provenance: Provenance;
  createdAt: string;
  status: "pending" | "generating" | "complete" | "error";
  version: number;
  previousVersions: string[];
  error?: string;
  timing?: {
    startedAt: string;
    completedAt: string;
    durationMs: number;
  };
}

// ---------------------------------------------------------------------------
// Edge
// ---------------------------------------------------------------------------

export interface Edge {
  from: string;
  to: string;
  type: "responded-to" | "split-from" | "derived" | "imported-from";
}

// ---------------------------------------------------------------------------
// Operation log
// ---------------------------------------------------------------------------

export type Operation =
  | { type: "human-typed"; fragmentId: string; content: string; timestamp: string }
  | {
      type: "ai-generated";
      // Optional: ephemeral generations don't persist a fragment, but the
      // LLM call itself should still appear in the X-ray. Empty string
      // / undefined → ephemeral.
      fragmentId: string;
      model: string;
      prompt: string;
      params: GenerationParams;
      timestamp: string;
      ephemeral?: boolean;
      durationMs?: number;
    }
  | { type: "split"; sourceFragmentId: string; charStart: number; charEnd: number; resultIds: string[]; timestamp: string }
  | { type: "move"; fragmentId: string; fromIndex: number; toIndex: number; timestamp: string }
  | {
      type: "merge";
      sourceIds: string[];
      resultId: string;
      timestamp: string;
      // The prompt and model used for the LLM merge call. Optional
      // because we may want to log a merge op before the LLM call (we
      // do — it lands eagerly so the canvas can show pending merge);
      // the route patches these fields onto the op once the call is
      // actually fired. Used by ChatView's x-ray to show what the
      // model received.
      prompt?: string;
      model?: string;
      mergeType?: string;
      preMergeSnapshot?: {
        sourceWasInSequence: boolean;
        targetWasInSequence: boolean;
        sourceWasInStage: boolean;
        targetWasInStage: boolean;
        preSourceSeqIdx: number;
        preTargetSeqIdx: number;
      };
      durationMs?: number;
    }
  | { type: "unmerge"; mergedId: string; restoredIds: string[]; timestamp: string }
  | { type: "prune"; fragmentId: string; timestamp: string }
  | { type: "restore"; fragmentId: string; timestamp: string }
  | { type: "zone-transfer"; fragmentId: string; from: "workspace" | "stage"; to: "workspace" | "stage"; timestamp: string }
  | { type: "pick"; fragmentId: string; timestamp: string }
  | {
      type: "reroll";
      sourceFragmentId: string;
      resultIds: string[];
      model: string;
      timestamp: string;
      selectedText?: string;
      prompt?: string;
      durationMs?: number;
    }
  | {
      type: "expand";
      sourceFragmentId: string;
      mode: string;
      resultIds: string[];
      timestamp: string;
      prompt?: string;
      model?: string;
      durationMs?: number;
    }
  | {
      type: "draft";
      parentId: string;
      resultIds: string[];
      model: string;
      timestamp: string;
      prompt?: string;
      durationMs?: number;
    }
  | {
      // Precision-spread phrase swap. Pure read on the workspace
      // (doesn't persist new fragments) but still hits the LLM, so
      // the X-ray needs to record it.
      type: "swap-phrase";
      sourceFragmentId: string;
      originalPhrase: string;
      alternativePhrase: string;
      method: string;
      swapCount: number;
      model: string;
      timestamp: string;
      prompt?: string;
      durationMs?: number;
    };

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export interface Workspace {
  id: string;
  createdAt: string;
  intent: string;
  completionCondition: string;
  mode: string;

  // The three independent structures
  fragments: Record<string, Fragment>;
  edges: Edge[];
  sequence: string[];
  stageIds: string[];
  canvasPositions: Record<string, { x: number; y: number }>;

  // Audit trail
  opLog: Operation[];

  // Settings
  settings: {
    rerollCount: number;
    draftCount: number;
    model: string;
  };
  contextBlockIds: string[];
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export function createWorkspace(
  intent: string,
  completionCondition: string,
  mode: string,
  settings?: Partial<Workspace["settings"]>
): Workspace {
  const rootId = uuidv4();
  const root: Fragment = {
    id: rootId,
    content: intent,
    provenance: { type: "system" },
    createdAt: new Date().toISOString(),
    status: "complete",
    version: 1,
    previousVersions: [],
  };

  return {
    id: uuidv4(),
    createdAt: new Date().toISOString(),
    intent,
    completionCondition,
    mode,
    fragments: { [rootId]: root },
    edges: [],
    sequence: [rootId],
    stageIds: [],
    canvasPositions: {},
    opLog: [],
    settings: {
      rerollCount: settings?.rerollCount ?? 3,
      draftCount: settings?.draftCount ?? 3,
      model: settings?.model ?? "sonnet",
    },
    contextBlockIds: [],
  };
}

// ---------------------------------------------------------------------------
// Fragment CRUD
// ---------------------------------------------------------------------------

export function addFragment(
  ws: Workspace,
  content: string,
  provenance: Provenance,
  status: Fragment["status"] = "complete"
): Fragment {
  const fragment: Fragment = {
    id: uuidv4(),
    content,
    provenance,
    createdAt: new Date().toISOString(),
    status,
    version: 1,
    previousVersions: [],
  };
  ws.fragments[fragment.id] = fragment;
  return fragment;
}

export function updateFragmentContent(
  ws: Workspace,
  fragmentId: string,
  content: string,
  status: Fragment["status"] = "complete"
): void {
  const f = ws.fragments[fragmentId];
  if (!f) return;
  if (f.content && f.content !== content) {
    f.previousVersions.push(f.content);
    f.version++;
  }
  f.content = content;
  f.status = status;
}

// ---------------------------------------------------------------------------
// Edge operations (append-only)
// ---------------------------------------------------------------------------

export function addEdge(ws: Workspace, from: string, to: string, type: Edge["type"]): void {
  ws.edges.push({ from, to, type });
}

/**
 * Get children of a fragment via edges of a given type.
 */
export function getChildren(ws: Workspace, fragmentId: string, edgeType?: Edge["type"]): Fragment[] {
  return ws.edges
    .filter((e) => e.from === fragmentId && (!edgeType || e.type === edgeType))
    .map((e) => ws.fragments[e.to])
    .filter((f): f is Fragment => !!f);
}

/**
 * Get parent of a fragment via edges of a given type.
 */
export function getParent(ws: Workspace, fragmentId: string, edgeType?: Edge["type"]): Fragment | undefined {
  const edge = ws.edges.find(
    (e) => e.to === fragmentId && (!edgeType || e.type === edgeType)
  );
  return edge ? ws.fragments[edge.from] : undefined;
}

/**
 * Get siblings: fragments that share the same parent via responded-to edges.
 */
export function getSiblings(ws: Workspace, fragmentId: string): Fragment[] {
  const parent = getParent(ws, fragmentId, "responded-to");
  if (!parent) return [ws.fragments[fragmentId]].filter(Boolean) as Fragment[];
  return getChildren(ws, parent.id, "responded-to");
}

// ---------------------------------------------------------------------------
// Sequence operations
// ---------------------------------------------------------------------------

export function appendToSequence(ws: Workspace, fragmentId: string): void {
  if (!ws.sequence.includes(fragmentId)) {
    ws.sequence.push(fragmentId);
  }
}

export function insertInSequence(ws: Workspace, fragmentId: string, atIndex: number): void {
  if (ws.sequence.includes(fragmentId)) {
    // Remove first, then insert
    ws.sequence = ws.sequence.filter((id) => id !== fragmentId);
  }
  ws.sequence.splice(atIndex, 0, fragmentId);
}

export function removeFromSequence(ws: Workspace, fragmentId: string): void {
  ws.sequence = ws.sequence.filter((id) => id !== fragmentId);
}

export function moveInSequence(ws: Workspace, fragmentId: string, toIndex: number): void {
  const fromIndex = ws.sequence.indexOf(fragmentId);
  if (fromIndex === -1) return;
  ws.sequence.splice(fromIndex, 1);
  const adjusted = toIndex > fromIndex ? toIndex - 1 : toIndex;
  ws.sequence.splice(adjusted, 0, fragmentId);

  ws.opLog.push({
    type: "move",
    fragmentId,
    fromIndex,
    toIndex: adjusted,
    timestamp: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Zone operations
// ---------------------------------------------------------------------------

export function moveToStage(ws: Workspace, fragmentId: string): void {
  removeFromSequence(ws, fragmentId);
  if (!ws.stageIds.includes(fragmentId)) {
    ws.stageIds.push(fragmentId);
  }
  ws.opLog.push({
    type: "zone-transfer",
    fragmentId,
    from: "workspace",
    to: "stage",
    timestamp: new Date().toISOString(),
  });
}

export function moveToWorkspace(ws: Workspace, fragmentId: string, atIndex?: number): void {
  ws.stageIds = ws.stageIds.filter((id) => id !== fragmentId);
  if (atIndex !== undefined) {
    insertInSequence(ws, fragmentId, atIndex);
  } else {
    appendToSequence(ws, fragmentId);
  }
  ws.opLog.push({
    type: "zone-transfer",
    fragmentId,
    from: "stage",
    to: "workspace",
    timestamp: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Split
// ---------------------------------------------------------------------------

function snapToWordBoundary(text: string, pos: number): number {
  if (pos <= 0) return 0;
  if (pos >= text.length) return text.length;
  const WINDOW = 15;
  const boundary = /[\s.,;:!?\-—–\/)}\]]/;
  for (let i = pos; i >= Math.max(0, pos - WINDOW); i--) {
    if (boundary.test(text[i])) return i + 1;
  }
  for (let i = pos; i <= Math.min(text.length - 1, pos + WINDOW); i++) {
    if (boundary.test(text[i])) return i;
  }
  return pos;
}

export function splitFragment(
  ws: Workspace,
  fragmentId: string,
  charStart: number,
  charEnd: number
): Fragment[] | null {
  const original = ws.fragments[fragmentId];
  if (!original || !original.content) return null;

  const text = original.content;
  const start = snapToWordBoundary(text, charStart);
  const end = snapToWordBoundary(text, charEnd);
  if (start >= end || end > text.length) return null;

  const beforeText = text.slice(0, start).trimEnd();
  const selectedText = text.slice(start, end).trim();
  const afterText = text.slice(end).trimStart();
  if (!selectedText) return null;

  const now = new Date().toISOString();
  const results: Fragment[] = [];
  const resultIds: string[] = [];

  if (beforeText) {
    const f = addFragment(ws, beforeText, { type: "split", sourceFragmentIds: [fragmentId] });
    addEdge(ws, fragmentId, f.id, "split-from");
    results.push(f);
    resultIds.push(f.id);
  }

  const sel = addFragment(ws, selectedText, { type: "split", sourceFragmentIds: [fragmentId] });
  addEdge(ws, fragmentId, sel.id, "split-from");
  results.push(sel);
  resultIds.push(sel.id);

  if (afterText) {
    const f = addFragment(ws, afterText, { type: "split", sourceFragmentIds: [fragmentId] });
    addEdge(ws, fragmentId, f.id, "split-from");
    results.push(f);
    resultIds.push(f.id);
  }

  // Replace in sequence
  const seqIdx = ws.sequence.indexOf(fragmentId);
  if (seqIdx !== -1) {
    ws.sequence.splice(seqIdx, 1, ...resultIds);
  }

  // Replace in stageIds if it was staged
  const stageIdx = ws.stageIds.indexOf(fragmentId);
  if (stageIdx !== -1) {
    ws.stageIds.splice(stageIdx, 1, ...resultIds);
  }

  // Inherit canvas position
  const pos = ws.canvasPositions[fragmentId];
  if (pos) {
    resultIds.forEach((id, i) => {
      ws.canvasPositions[id] = { x: pos.x, y: pos.y + i * 80 };
    });
  }

  // Chain split children with responded-to edges so layout engines order them
  for (let i = 0; i < resultIds.length - 1; i++) {
    addEdge(ws, resultIds[i], resultIds[i + 1], "responded-to");
  }

  // Reconnect: if parent had a responded-to predecessor, link it to first child
  // and if parent had a responded-to successor, link last child to it
  for (const edge of ws.edges) {
    if (edge.type === "responded-to" && edge.to === fragmentId) {
      addEdge(ws, edge.from, resultIds[0], "responded-to");
    }
    if (edge.type === "responded-to" && edge.from === fragmentId) {
      addEdge(ws, resultIds[resultIds.length - 1], edge.to, "responded-to");
    }
  }

  // Mark original as consumed — keep for lineage but hide from all views
  original.status = "pending"; // reuse "pending" as "consumed/hidden"
  original.content = `[split into ${resultIds.length} fragments]`;

  // Remove original's canvas position
  delete ws.canvasPositions[fragmentId];

  ws.opLog.push({
    type: "split",
    sourceFragmentId: fragmentId,
    charStart: start,
    charEnd: end,
    resultIds,
    timestamp: now,
  });

  return results;
}

// ---------------------------------------------------------------------------
// Merge / Unmerge
// ---------------------------------------------------------------------------

export interface MergeResult {
  mergedFrag: Fragment;
  sourceContent: string;
  targetContent: string;
}

/**
 * Merge two fragments into a new "merged" fragment.
 *
 * Creates a pending fragment (status: "generating") whose content the
 * caller is expected to fill in via an LLM call. All synchronous state
 * mutations happen here:
 *   - source/target stashed to previousVersions, hidden as "[merged into X]"
 *   - merged fragment replaces target in sequence/stage (or source if
 *     target wasn't placed)
 *   - canvas position inherited from target (fallback: source)
 *   - opLog gets a "merge" entry with preMergeSnapshot for unmerge
 *
 * Returns null if either fragment is missing.
 */
export function mergeFragments(
  ws: Workspace,
  sourceId: string,
  targetId: string,
): MergeResult | null {
  const sourceFrag = ws.fragments[sourceId];
  const targetFrag = ws.fragments[targetId];
  if (!sourceFrag || !targetFrag) return null;

  const sourceContent = sourceFrag.content;
  const targetContent = targetFrag.content;

  // Capture pre-mutation membership and indices. CRITICAL: read indices
  // BEFORE mutating ws.sequence below — otherwise indexOf returns -1 and
  // the unmerge restore-order sort becomes meaningless.
  const sourceInSequence = ws.sequence.includes(sourceId);
  const sourceInStage = ws.stageIds.includes(sourceId);
  const targetInSequence = ws.sequence.includes(targetId);
  const targetInStage = ws.stageIds.includes(targetId);
  const preSourceSeqIdx = ws.sequence.indexOf(sourceId);
  const preTargetSeqIdx = ws.sequence.indexOf(targetId);

  const startedAtIso = new Date().toISOString();
  const mergedFrag = addFragment(
    ws,
    "",
    { type: "merged", sourceFragmentIds: [sourceId, targetId] },
    "generating",
  );
  mergedFrag.timing = { startedAt: startedAtIso, completedAt: "", durationMs: 0 };

  addEdge(ws, sourceId, mergedFrag.id, "derived");
  addEdge(ws, targetId, mergedFrag.id, "derived");

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

  if (ws.canvasPositions[targetId]) {
    ws.canvasPositions[mergedFrag.id] = { ...ws.canvasPositions[targetId] };
  } else if (ws.canvasPositions[sourceId]) {
    ws.canvasPositions[mergedFrag.id] = { ...ws.canvasPositions[sourceId] };
  }
  delete ws.canvasPositions[sourceId];
  delete ws.canvasPositions[targetId];

  sourceFrag.previousVersions.push(sourceFrag.content);
  targetFrag.previousVersions.push(targetFrag.content);
  sourceFrag.status = "pending";
  sourceFrag.content = `[merged into ${mergedFrag.id}]`;
  targetFrag.status = "pending";
  targetFrag.content = `[merged into ${mergedFrag.id}]`;

  ws.opLog.push({
    type: "merge",
    sourceIds: [sourceId, targetId],
    resultId: mergedFrag.id,
    timestamp: startedAtIso,
    preMergeSnapshot: {
      sourceWasInSequence: sourceInSequence,
      targetWasInSequence: targetInSequence,
      sourceWasInStage: sourceInStage,
      targetWasInStage: targetInStage,
      preSourceSeqIdx,
      preTargetSeqIdx,
    },
  });

  return { mergedFrag, sourceContent, targetContent };
}

export interface UnmergeResult {
  ok: boolean;
  restoredIds: string[];
  error?: string;
}

/**
 * Reverse a merge: restore source fragments' contents from
 * previousVersions, put them back into sequence/stage at roughly their
 * original positions (using preMergeSnapshot), and delete the merged
 * fragment along with its derivation edges.
 */
export function unmergeFragments(ws: Workspace, mergedId: string): UnmergeResult {
  const mergedFrag = ws.fragments[mergedId];
  if (!mergedFrag) return { ok: false, restoredIds: [], error: "Merged fragment not found" };
  if (mergedFrag.provenance.type !== "merged") {
    return { ok: false, restoredIds: [], error: "Fragment is not a merged result" };
  }

  const sourceIds = mergedFrag.provenance.sourceFragmentIds ?? [];
  if (sourceIds.length === 0) {
    return { ok: false, restoredIds: [], error: "No source fragments to restore" };
  }

  // Find the most recent merge op for this resultId — it carries the snapshot.
  let snapshot: Extract<Operation, { type: "merge" }>["preMergeSnapshot"] = undefined;
  for (let i = ws.opLog.length - 1; i >= 0; i--) {
    const op = ws.opLog[i];
    if (op.type === "merge" && op.resultId === mergedId) {
      snapshot = op.preMergeSnapshot;
      break;
    }
  }

  // Restore each source's content from previousVersions.
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

  // Helpers: pull snapshot membership flags for either source.
  const wasInSequence = (id: string) =>
    !!snapshot &&
    ((id === sourceIds[0] && snapshot.sourceWasInSequence) ||
      (id === sourceIds[1] && snapshot.targetWasInSequence));
  const wasInStage = (id: string) =>
    !!snapshot &&
    ((id === sourceIds[0] && snapshot.sourceWasInStage) ||
      (id === sourceIds[1] && snapshot.targetWasInStage));

  // Determine ordered list of sources to restore in sequence (by original idx).
  const seqRestorations: string[] = [];
  if (snapshot) {
    const ordered = [...sourceIds].sort((a, b) => {
      const idxA = a === sourceIds[0] ? snapshot!.preSourceSeqIdx : snapshot!.preTargetSeqIdx;
      const idxB = b === sourceIds[0] ? snapshot!.preSourceSeqIdx : snapshot!.preTargetSeqIdx;
      return idxA - idxB;
    });
    for (const id of ordered) {
      if (wasInSequence(id) && ws.fragments[id]) seqRestorations.push(id);
    }
  } else {
    for (const id of sourceIds) {
      if (ws.fragments[id]) seqRestorations.push(id);
    }
  }

  // Determine ordered list of sources to restore in stage.
  const stageRestorations: string[] = [];
  if (snapshot) {
    for (const id of sourceIds) {
      if (wasInStage(id) && ws.fragments[id]) stageRestorations.push(id);
    }
  }

  // Splice into sequence: replace merged-id slot if present, otherwise append.
  const mergedSeqIdx = ws.sequence.indexOf(mergedId);
  if (mergedSeqIdx !== -1) {
    ws.sequence.splice(mergedSeqIdx, 1, ...seqRestorations);
  } else {
    for (const id of seqRestorations) {
      if (!ws.sequence.includes(id)) ws.sequence.push(id);
    }
  }

  // Splice into stage: replace merged-id slot if present, otherwise append.
  const mergedStageIdx = ws.stageIds.indexOf(mergedId);
  if (mergedStageIdx !== -1) {
    ws.stageIds.splice(mergedStageIdx, 1, ...stageRestorations);
  } else {
    for (const id of stageRestorations) {
      if (!ws.stageIds.includes(id)) ws.stageIds.push(id);
    }
  }

  delete ws.fragments[mergedId];
  ws.edges = ws.edges.filter((e) => e.from !== mergedId && e.to !== mergedId);
  delete ws.canvasPositions[mergedId];

  ws.opLog.push({
    type: "unmerge",
    mergedId,
    restoredIds: restored,
    timestamp: new Date().toISOString(),
  });

  return { ok: true, restoredIds: restored };
}

// ---------------------------------------------------------------------------
// Context assembly (for AI generation)
// ---------------------------------------------------------------------------

/**
 * Build the workspace context for AI generation.
 * Returns all workspace-sequence fragments in order with provenance.
 */
export function getWorkspaceContext(
  ws: Workspace
): Array<{ id: string; content: string; provenance: Provenance }> {
  return ws.sequence
    .map((id) => ws.fragments[id])
    .filter((f): f is Fragment => !!f && f.status === "complete")
    .map((f) => ({ id: f.id, content: f.content, provenance: f.provenance }));
}

/**
 * Build conversation history for AI (flattened sequence as messages).
 */
export function getConversationHistory(
  ws: Workspace
): Array<{ role: "user" | "assistant"; content: string }> {
  return ws.sequence
    .map((id) => ws.fragments[id])
    .filter((f): f is Fragment => !!f && f.status === "complete" && f.provenance.type !== "system")
    .map((f) => ({
      role: (f.provenance.type === "ai-generated" ? "assistant" : "user") as "user" | "assistant",
      content: f.content,
    }));
}

// ---------------------------------------------------------------------------
// Staged fragments
// ---------------------------------------------------------------------------

export function getStagedFragments(ws: Workspace): Fragment[] {
  return ws.stageIds
    .map((id) => ws.fragments[id])
    .filter((f): f is Fragment => !!f);
}

// ---------------------------------------------------------------------------
// Tree reconstruction (for tree view)
// ---------------------------------------------------------------------------

/**
 * Build a tree from responded-to edges for the tree view.
 * Returns adjacency: parentId → childIds[].
 */
export function buildTreeFromEdges(
  ws: Workspace
): { roots: string[]; children: Record<string, string[]> } {
  const children: Record<string, string[]> = {};
  const hasParent = new Set<string>();

  for (const edge of ws.edges) {
    if (edge.type === "responded-to") {
      if (!children[edge.from]) children[edge.from] = [];
      children[edge.from].push(edge.to);
      hasParent.add(edge.to);
    }
  }

  const roots = Object.keys(ws.fragments).filter((id) => !hasParent.has(id));
  return { roots, children };
}
