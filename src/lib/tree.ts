import { v4 as uuidv4 } from "uuid";

export interface TreeNode {
  id: string;
  parentId: string | null;
  role: "user" | "assistant" | "system";
  content: string;
  childIds: string[];
  source: "human" | "ai-draft" | "ai-completion";
  status: "pending" | "generating" | "complete" | "error";
  pruned: boolean;
  selected: boolean; // is this node on the active path?
  version: number;
  previousVersions: string[]; // content snapshots
  createdAt: string;
  model?: string;
  error?: string;
  timing?: {
    startedAt: string;
    completedAt: string;
    durationMs: number;
  };
}

export interface ConversationTree {
  id: string;
  createdAt: string;
  intent: string;
  completionCondition: string;
  mode: string;
  nodes: Record<string, TreeNode>;
  rootId: string;
  activePathIds: string[]; // ordered list of selected node IDs from root to leaf
  settings: {
    rerollCount: number;
    draftCount: number;
    model: string;
  };
  contextBlockIds: string[]; // references to context library blocks
  canvasPositions?: Record<string, { x: number; y: number }>; // free-form node positions for canvas view
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
