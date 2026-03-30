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
