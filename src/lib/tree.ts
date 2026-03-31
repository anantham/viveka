import { v4 as uuidv4 } from "uuid";

// ---------------------------------------------------------------------------
// Provenance: who/what produced a fragment and how
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
  type: "human-typed" | "ai-generated" | "split" | "extracted" | "imported" | "merged";
  model?: string;            // e.g. "claude-sonnet-4-6", "meta-llama/llama-3.1-8b-instruct"
  prompt?: string;           // what was sent to generate this
  params?: GenerationParams; // sampling parameters used
  snapshotId?: string;       // workspace snapshot at generation time
  sourceFragmentIds?: string[]; // fragments this was derived from (split, merge)
  sourceRef?: string;        // external source (URL, file path, vault note)
}

// ---------------------------------------------------------------------------
// Operation log: append-only audit trail for reproducibility
// ---------------------------------------------------------------------------

export type Operation =
  | { type: "human-typed"; fragmentId: string; content: string; position: number; timestamp: string }
  | { type: "ai-generated"; fragmentId: string; model: string; prompt: string; params: GenerationParams; snapshotId: string; timestamp: string }
  | { type: "split"; sourceFragmentId: string; charStart: number; charEnd: number; resultIds: string[]; timestamp: string }
  | { type: "move"; fragmentId: string; fromIndex: number; toIndex: number; timestamp: string }
  | { type: "merge"; sourceIds: string[]; resultId: string; timestamp: string }
  | { type: "prune"; fragmentId: string; timestamp: string }
  | { type: "restore"; fragmentId: string; timestamp: string }
  | { type: "zone-transfer"; fragmentId: string; from: FragmentZone; to: FragmentZone; timestamp: string }
  | { type: "reroll"; sourceFragmentId: string; selection: string; resultIds: string[]; model: string; timestamp: string }
  | { type: "expand"; sourceFragmentId: string; mode: string; resultIds: string[]; timestamp: string };

// ---------------------------------------------------------------------------
// Fragment: the primitive unit of content
// ---------------------------------------------------------------------------

export type FragmentZone = "workspace" | "stage" | "pruned";

export interface TreeNode {
  id: string;
  parentId: string | null;
  role: "user" | "assistant" | "system";
  content: string;
  childIds: string[];
  source: "human" | "ai-draft" | "ai-completion";
  status: "pending" | "generating" | "complete" | "error";
  pruned: boolean;
  selected: boolean;
  version: number;
  previousVersions: string[];
  createdAt: string;
  model?: string;
  error?: string;
  timing?: {
    startedAt: string;
    completedAt: string;
    durationMs: number;
  };
  // --- Fragment extensions (backward-compatible, optional) ---
  provenance?: Provenance;
  zone?: FragmentZone;       // default: "workspace"
  sequenceIndex?: number;    // position in reading order
}

export interface ConversationTree {
  id: string;
  createdAt: string;
  intent: string;
  completionCondition: string;
  mode: string;
  nodes: Record<string, TreeNode>;
  rootId: string;
  activePathIds: string[];
  settings: {
    rerollCount: number;
    draftCount: number;
    model: string;
  };
  contextBlockIds: string[];
  canvasPositions?: Record<string, { x: number; y: number }>;
  // --- Workspace extensions ---
  sequence?: string[];       // explicit reading order (fragment IDs). If absent, derived from tree walk.
  opLog?: Operation[];       // append-only operation log
}

// --- Tree operations ---

export function createTree(
  intent: string,
  completionCondition: string,
  mode: string,
  settings?: Partial<ConversationTree["settings"]>
): ConversationTree {
  const rootId = uuidv4();
  const root: TreeNode = {
    id: rootId,
    parentId: null,
    role: "system",
    content: intent,
    childIds: [],
    source: "human",
    status: "complete",
    pruned: false,
    selected: true,
    version: 1,
    previousVersions: [],
    createdAt: new Date().toISOString(),
  };

  return {
    id: uuidv4(),
    createdAt: new Date().toISOString(),
    intent,
    completionCondition,
    mode,
    nodes: { [rootId]: root },
    rootId,
    activePathIds: [rootId],
    settings: {
      rerollCount: settings?.rerollCount ?? 3,
      draftCount: settings?.draftCount ?? 3,
      model: settings?.model ?? "sonnet",
    },
    contextBlockIds: [],
  };
}

export function addNode(
  tree: ConversationTree,
  parentId: string,
  role: TreeNode["role"],
  content: string,
  source: TreeNode["source"],
  status: TreeNode["status"] = "complete"
): TreeNode {
  const node: TreeNode = {
    id: uuidv4(),
    parentId,
    role,
    content,
    childIds: [],
    source,
    status,
    pruned: false,
    selected: false,
    version: 1,
    previousVersions: [],
    createdAt: new Date().toISOString(),
  };

  tree.nodes[node.id] = node;
  if (tree.nodes[parentId]) {
    tree.nodes[parentId].childIds.push(node.id);
  }

  return node;
}

export function addPendingNodes(
  tree: ConversationTree,
  parentId: string,
  role: TreeNode["role"],
  source: TreeNode["source"],
  count: number
): TreeNode[] {
  const nodes: TreeNode[] = [];
  for (let i = 0; i < count; i++) {
    nodes.push(addNode(tree, parentId, role, "", source, "generating"));
  }
  return nodes;
}

export function updateNodeContent(
  tree: ConversationTree,
  nodeId: string,
  content: string,
  status: TreeNode["status"] = "complete"
): void {
  const node = tree.nodes[nodeId];
  if (!node) return;

  // Save previous version
  if (node.content && node.content !== content) {
    node.previousVersions.push(node.content);
    node.version++;
  }

  node.content = content;
  node.status = status;
}

export function selectNode(
  tree: ConversationTree,
  nodeId: string
): void {
  // Deselect all nodes
  for (const n of Object.values(tree.nodes)) {
    n.selected = false;
  }

  // Walk up from nodeId to root, selecting each node
  const pathIds: string[] = [];
  let current: string | null = nodeId;
  while (current) {
    const node: TreeNode | undefined = tree.nodes[current];
    if (!node) break;
    node.selected = true;
    pathIds.unshift(current);
    current = node.parentId;
  }

  // Walk down from nodeId following first selected child (or first child)
  current = nodeId;
  while (current) {
    const node: TreeNode | undefined = tree.nodes[current];
    if (!node || node.childIds.length === 0) break;
    // Pick first non-pruned child
    const nextChild: string | undefined = node.childIds.find((cid: string) => !tree.nodes[cid]?.pruned);
    if (!nextChild) break;
    tree.nodes[nextChild].selected = true;
    pathIds.push(nextChild);
    current = nextChild;
  }

  tree.activePathIds = pathIds;
}

export function pruneNode(
  tree: ConversationTree,
  nodeId: string
): void {
  const node = tree.nodes[nodeId];
  if (!node) return;
  node.pruned = true;

  // Recursively prune children
  for (const childId of node.childIds) {
    pruneNode(tree, childId);
  }

  // If pruned node was on active path, re-select from parent
  if (node.selected && node.parentId) {
    selectNode(tree, node.parentId);
  }
}

export function unpruneNode(
  tree: ConversationTree,
  nodeId: string
): void {
  const node = tree.nodes[nodeId];
  if (!node) return;
  node.pruned = false;
  // Don't automatically unprune children
}

export function getActivePath(tree: ConversationTree): TreeNode[] {
  return tree.activePathIds
    .map((id) => tree.nodes[id])
    .filter((n): n is TreeNode => !!n);
}

export function getConversationHistory(
  tree: ConversationTree
): Array<{ role: "user" | "assistant"; content: string }> {
  return getActivePath(tree)
    .filter((n) => n.role === "user" || n.role === "assistant")
    .filter((n) => n.status === "complete")
    .map((n) => ({
      role: n.role as "user" | "assistant",
      content: n.content,
    }));
}

export function getSiblings(
  tree: ConversationTree,
  nodeId: string
): TreeNode[] {
  const node = tree.nodes[nodeId];
  if (!node || !node.parentId) return [node].filter(Boolean);
  const parent = tree.nodes[node.parentId];
  if (!parent) return [node];
  return parent.childIds
    .map((id) => tree.nodes[id])
    .filter((n): n is TreeNode => !!n && !n.pruned);
}

export function getDepth(tree: ConversationTree, nodeId: string): number {
  let depth = 0;
  let current: string | null = nodeId;
  while (current) {
    const node: TreeNode | undefined = tree.nodes[current];
    if (!node || !node.parentId) break;
    current = node.parentId;
    depth++;
  }
  return depth;
}

/**
 * Create a sibling node (same parent, same role) with modified content.
 * Used by phrase reroll to create alternative versions of a node.
 */
export function duplicateNodeWithEdit(
  tree: ConversationTree,
  nodeId: string,
  newContent: string
): TreeNode | null {
  const original = tree.nodes[nodeId];
  if (!original || !original.parentId) return null;

  const sibling = addNode(
    tree,
    original.parentId,
    original.role,
    newContent,
    original.source,
    "complete"
  );
  sibling.model = original.model;
  return sibling;
}

// --- Split node mid-text (tangent/star mode) ---

/**
 * Snap a character position to the nearest word boundary.
 * Looks for the nearest space or punctuation character within a small window
 * around the given position, preferring to break at whitespace.
 */
export function snapToWordBoundary(text: string, charPosition: number): number {
  // Clamp to valid range
  if (charPosition <= 0) return 0;
  if (charPosition >= text.length) return text.length;

  const SNAP_WINDOW = 15; // max chars to search in each direction
  const wordBoundaryPattern = /[\s.,;:!?\-—–\/)}\]]/;

  // Look backwards first (prefer breaking before a word)
  for (let i = charPosition; i >= Math.max(0, charPosition - SNAP_WINDOW); i--) {
    if (wordBoundaryPattern.test(text[i])) {
      // Snap to after the boundary character (keep punctuation with the truncated part)
      return i + 1;
    }
  }

  // Look forwards if no boundary found backwards
  for (let i = charPosition; i <= Math.min(text.length - 1, charPosition + SNAP_WINDOW); i++) {
    if (wordBoundaryPattern.test(text[i])) {
      return i;
    }
  }

  // No boundary found at all — use the raw position
  return charPosition;
}

/**
 * Split a node's content at a given character position.
 * - Truncates the original node's content at the (word-snapped) position, appending "..."
 * - Saves the original content as a previous version
 * - Creates a new empty child node (role: "user", source: "human", status: "complete")
 * - Updates activePathIds to include the new child
 *
 * Returns the updated parent node and the new child node.
 */
export function splitNodeAtPosition(
  tree: ConversationTree,
  nodeId: string,
  charPosition: number
): { parentNode: TreeNode; childNode: TreeNode } | null {
  const node = tree.nodes[nodeId];
  if (!node) return null;

  // Don't split empty nodes or nodes with trivially short content
  if (!node.content || node.content.length < 2) return null;

  // Snap to nearest word boundary
  const splitAt = snapToWordBoundary(node.content, charPosition);

  // Don't split at the very beginning or very end
  if (splitAt <= 0 || splitAt >= node.content.length) return null;

  const truncatedContent = node.content.slice(0, splitAt).trimEnd() + "...";

  // Save original content as a previous version before truncating
  node.previousVersions.push(node.content);
  node.version++;
  node.content = truncatedContent;

  // Create new empty child node for the user's tangent/interruption
  const childNode = addNode(tree, nodeId, "user", "", "human", "complete");

  // Update active path to include the new child
  selectNode(tree, childNode.id);

  return { parentNode: node, childNode };
}

// ---------------------------------------------------------------------------
// Workspace / fragment operations
// ---------------------------------------------------------------------------

/**
 * Get or initialize the workspace sequence (reading order).
 * If no explicit sequence exists, derives it from the tree's active path.
 */
export function getSequence(tree: ConversationTree): string[] {
  if (tree.sequence && tree.sequence.length > 0) {
    return tree.sequence;
  }
  // Derive from active path — only workspace-zone, non-pruned fragments
  return tree.activePathIds.filter((id) => {
    const n = tree.nodes[id];
    return n && !n.pruned && (n.zone ?? "workspace") === "workspace";
  });
}

/**
 * Ensure opLog exists and append an operation.
 */
function logOp(tree: ConversationTree, op: Operation): void {
  if (!tree.opLog) tree.opLog = [];
  tree.opLog.push(op);
}

/**
 * Split a fragment at a text selection range into 2 or 3 fragments.
 *
 * - If selection starts at 0: produces [selection, after]
 * - If selection ends at content.length: produces [before, selection]
 * - Otherwise: produces [before, selection, after]
 *
 * The original fragment is replaced in the sequence by the new fragments.
 * All new fragments inherit the original's parentId and tree position.
 */
export function splitFragmentAtRange(
  tree: ConversationTree,
  fragmentId: string,
  charStart: number,
  charEnd: number
): TreeNode[] | null {
  const original = tree.nodes[fragmentId];
  if (!original || !original.content) return null;

  const text = original.content;
  const start = snapToWordBoundary(text, charStart);
  const end = snapToWordBoundary(text, charEnd);

  if (start >= end || end > text.length) return null;

  const beforeText = text.slice(0, start).trimEnd();
  const selectedText = text.slice(start, end).trim();
  const afterText = text.slice(end).trimStart();

  if (!selectedText) return null;

  const results: TreeNode[] = [];
  const resultIds: string[] = [];
  const now = new Date().toISOString();

  // Create fragment for "before" (if non-empty)
  if (beforeText) {
    const before: TreeNode = {
      id: uuidv4(),
      parentId: original.parentId,
      role: original.role,
      content: beforeText,
      childIds: [],
      source: original.source,
      status: "complete",
      pruned: false,
      selected: original.selected,
      version: 1,
      previousVersions: [],
      createdAt: now,
      model: original.model,
      provenance: { type: "split", sourceFragmentIds: [fragmentId] },
      zone: original.zone ?? "workspace",
    };
    tree.nodes[before.id] = before;
    results.push(before);
    resultIds.push(before.id);
  }

  // Create fragment for the selection (always present)
  const selection: TreeNode = {
    id: uuidv4(),
    parentId: original.parentId,
    role: original.role,
    content: selectedText,
    childIds: [],
    source: original.source,
    status: "complete",
    pruned: false,
    selected: original.selected,
    version: 1,
    previousVersions: [],
    createdAt: now,
    model: original.model,
    provenance: { type: "split", sourceFragmentIds: [fragmentId] },
    zone: original.zone ?? "workspace",
  };
  tree.nodes[selection.id] = selection;
  results.push(selection);
  resultIds.push(selection.id);

  // Create fragment for "after" (if non-empty)
  if (afterText) {
    const after: TreeNode = {
      id: uuidv4(),
      parentId: original.parentId,
      role: original.role,
      content: afterText,
      childIds: [],
      source: original.source,
      status: "complete",
      pruned: false,
      selected: original.selected,
      version: 1,
      previousVersions: [],
      createdAt: now,
      model: original.model,
      provenance: { type: "split", sourceFragmentIds: [fragmentId] },
      zone: original.zone ?? "workspace",
    };
    tree.nodes[after.id] = after;
    results.push(after);
    resultIds.push(after.id);
  }

  // Replace in sequence
  const seq = getSequence(tree);
  const idx = seq.indexOf(fragmentId);
  if (idx !== -1) {
    seq.splice(idx, 1, ...resultIds);
    tree.sequence = seq;
  }

  // Replace in activePathIds
  const pathIdx = tree.activePathIds.indexOf(fragmentId);
  if (pathIdx !== -1) {
    tree.activePathIds.splice(pathIdx, 1, ...resultIds);
  }

  // Replace in parent's childIds
  if (original.parentId && tree.nodes[original.parentId]) {
    const parent = tree.nodes[original.parentId];
    const childIdx = parent.childIds.indexOf(fragmentId);
    if (childIdx !== -1) {
      parent.childIds.splice(childIdx, 1, ...resultIds);
    }
  }

  // Soft-delete original (keep for lineage)
  original.pruned = true;
  original.zone = "pruned";

  logOp(tree, {
    type: "split",
    sourceFragmentId: fragmentId,
    charStart: start,
    charEnd: end,
    resultIds,
    timestamp: now,
  });

  return results;
}

/**
 * Move a fragment to a new position in the reading order.
 */
export function moveFragment(
  tree: ConversationTree,
  fragmentId: string,
  toIndex: number
): void {
  const seq = getSequence(tree);
  const fromIndex = seq.indexOf(fragmentId);
  if (fromIndex === -1) return;

  seq.splice(fromIndex, 1);
  // Adjust target if it shifted due to removal
  const adjustedTo = toIndex > fromIndex ? toIndex - 1 : toIndex;
  seq.splice(adjustedTo, 0, fragmentId);
  tree.sequence = seq;

  logOp(tree, {
    type: "move",
    fragmentId,
    fromIndex,
    toIndex: adjustedTo,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Transfer a fragment between workspace and stage zones.
 */
export function transferZone(
  tree: ConversationTree,
  fragmentId: string,
  toZone: FragmentZone
): void {
  const node = tree.nodes[fragmentId];
  if (!node) return;

  const fromZone = node.zone ?? "workspace";
  if (fromZone === toZone) return;

  node.zone = toZone;

  const seq = getSequence(tree);

  if (toZone === "workspace" && !seq.includes(fragmentId)) {
    // Add to end of sequence when entering workspace
    seq.push(fragmentId);
    tree.sequence = seq;
  } else if (toZone !== "workspace" && seq.includes(fragmentId)) {
    // Remove from sequence when leaving workspace
    tree.sequence = seq.filter((id) => id !== fragmentId);
  }

  logOp(tree, {
    type: "zone-transfer",
    fragmentId,
    from: fromZone,
    to: toZone,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Get all fragments in a specific zone.
 */
export function getFragmentsByZone(
  tree: ConversationTree,
  zone: FragmentZone
): TreeNode[] {
  return Object.values(tree.nodes).filter(
    (n) => (n.zone ?? "workspace") === zone && !n.pruned
  );
}

/**
 * Build the workspace context for AI generation.
 * Returns all workspace-zone fragments in reading order with provenance metadata.
 */
export function getWorkspaceContext(
  tree: ConversationTree
): Array<{ id: string; content: string; provenance: Provenance | undefined; role: string }> {
  const seq = getSequence(tree);
  return seq
    .map((id) => tree.nodes[id])
    .filter((n): n is TreeNode => !!n && !n.pruned)
    .map((n) => ({
      id: n.id,
      content: n.content,
      provenance: n.provenance,
      role: n.role,
    }));
}
