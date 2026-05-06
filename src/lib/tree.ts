/**
 * Legacy bridge module — types and helpers used by the still-unmigrated
 * loom view components (CanvasView, CanvasNode, ChatBubbleView,
 * ReaderView, TreeMapView, VersionHistory).
 *
 * The canonical data model is `Workspace` in ./workspace.ts. New code
 * should NOT import from this file. The remaining consumers are legacy
 * views that take a `ConversationTree` shape; LoomInterface bridges by
 * calling `wsToLegacyTree(ws)` which returns a `ConversationTree`-shaped
 * object derived from a `Workspace`.
 *
 * This file used to contain ~25 operations (createTree, addNode,
 * splitFragmentAtRange, etc.) that were superseded by the equivalents
 * in ./workspace.ts. Those operations were unused outside this module
 * and were removed during the Phase C cleanup (see
 * docs/architecture/canvas.md and SYNTHESIS.md). What remains is just
 * the types the legacy views read and the one helper they actually
 * call.
 *
 * Plan to fully retire this file: migrate the legacy views to consume
 * `Workspace` directly, then delete this file along with
 * `workspace-migrate.ts` and `tree-store.ts`.
 */

// ---------------------------------------------------------------------------
// Provenance + Operation log
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

// Kept narrowly here only because `ConversationTree.opLog` quotes it.
// Workspace's Operation type is the canonical one (./workspace.ts).
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

export type FragmentZone = "workspace" | "stage" | "pruned";

// ---------------------------------------------------------------------------
// Legacy node + tree shapes (read by the unmigrated view components)
// ---------------------------------------------------------------------------

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
  // Workspace-bridge extensions populated by wsToLegacyTree.
  provenance?: Provenance;
  zone?: FragmentZone;
  sequenceIndex?: number;
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
  sequence?: string[];
  opLog?: Operation[];
}

// ---------------------------------------------------------------------------
// Helpers actually consumed by views
// ---------------------------------------------------------------------------

/** Walk the active-path id chain and return the corresponding TreeNodes. */
export function getActivePath(tree: ConversationTree): TreeNode[] {
  return tree.activePathIds
    .map((id) => tree.nodes[id])
    .filter((n): n is TreeNode => !!n);
}
