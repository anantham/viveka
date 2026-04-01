/**
 * Migration adapter: ConversationTree → Workspace.
 * Converts old tree data on read. No lossy conversion —
 * parentId/childIds become edges, activePathIds become sequence.
 */

import type { ConversationTree, TreeNode } from "./tree";
import type { Workspace, Fragment, Edge, Provenance } from "./workspace";

function nodeToProvenance(node: TreeNode): Provenance {
  if (node.role === "system") return { type: "system" };
  if (node.source === "ai-completion" || node.source === "ai-draft") {
    return {
      type: "ai-generated",
      model: node.model,
      sourceFragmentIds: node.provenance?.sourceFragmentIds,
    };
  }
  if (node.provenance) return node.provenance;
  return { type: "human-typed" };
}

function nodeToFragment(node: TreeNode): Fragment {
  return {
    id: node.id,
    content: node.content,
    provenance: nodeToProvenance(node),
    createdAt: node.createdAt,
    status: node.status,
    version: node.version,
    previousVersions: node.previousVersions,
    error: node.error,
    timing: node.timing,
  };
}

export function treeToWorkspace(tree: ConversationTree): Workspace {
  // Convert nodes → fragments
  const fragments: Record<string, Fragment> = {};
  for (const node of Object.values(tree.nodes)) {
    fragments[node.id] = nodeToFragment(node);
  }

  // Convert parentId/childIds → edges
  const edges: Edge[] = [];
  for (const node of Object.values(tree.nodes)) {
    if (node.parentId) {
      edges.push({
        from: node.parentId,
        to: node.id,
        type: "responded-to",
      });
    }
  }

  // activePathIds → sequence (only non-pruned)
  const sequence = (tree.sequence ?? tree.activePathIds).filter(
    (id) => {
      const node = tree.nodes[id];
      return node && !node.pruned && (node.zone ?? "workspace") === "workspace";
    }
  );

  // Staged fragments
  const stageIds = Object.values(tree.nodes)
    .filter((n) => n.zone === "stage")
    .map((n) => n.id);

  return {
    id: tree.id,
    createdAt: tree.createdAt,
    intent: tree.intent,
    completionCondition: tree.completionCondition,
    mode: tree.mode,
    fragments,
    edges,
    sequence,
    stageIds,
    canvasPositions: tree.canvasPositions ?? {},
    opLog: (tree.opLog ?? []) as Workspace["opLog"],
    settings: tree.settings,
    contextBlockIds: tree.contextBlockIds,
  };
}

/**
 * Check if data is already a Workspace (has fragments field)
 * vs a ConversationTree (has nodes field).
 */
export function isWorkspace(data: unknown): data is Workspace {
  return typeof data === "object" && data !== null && "fragments" in data && "edges" in data;
}

/**
 * Load data that might be either format. Returns Workspace.
 */
export function ensureWorkspace(data: unknown): Workspace {
  if (isWorkspace(data)) return data as Workspace;
  return treeToWorkspace(data as ConversationTree);
}
