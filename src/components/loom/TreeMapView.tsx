"use client";

import { ConversationTree, TreeNode } from "@/lib/tree";

interface TreeMapViewProps {
  tree: ConversationTree;
  onNodeSelect: (nodeId: string) => void;
  onPrune: (nodeId: string) => void;
  onUnprune: (nodeId: string) => void;
}

export default function TreeMapView({
  tree,
  onNodeSelect,
  onPrune,
  onUnprune,
}: TreeMapViewProps) {
  const root = tree.nodes[tree.rootId];
  if (!root) return null;

  return (
    <div className="overflow-auto p-4 select-none">
      <div className="flex items-start gap-1">
        <NodeBranch
          tree={tree}
          nodeId={tree.rootId}
          onNodeSelect={onNodeSelect}
          onPrune={onPrune}
          onUnprune={onUnprune}
        />
      </div>
    </div>
  );
}

function NodeBranch({
  tree,
  nodeId,
  onNodeSelect,
  onPrune,
  onUnprune,
}: {
  tree: ConversationTree;
  nodeId: string;
  onNodeSelect: (nodeId: string) => void;
  onPrune: (nodeId: string) => void;
  onUnprune: (nodeId: string) => void;
}) {
  const node = tree.nodes[nodeId];
  if (!node) return null;

  const visibleChildren = node.childIds
    .map((id) => tree.nodes[id])
    .filter((n): n is TreeNode => !!n);

  const isOnPath = tree.activePathIds.includes(nodeId);

  return (
    <div className="flex items-start">
      {/* This node */}
      <div className="flex flex-col items-center">
        <NodeDot
          node={node}
          isOnPath={isOnPath}
          onClick={() => onNodeSelect(nodeId)}
          onPrune={() => (node.pruned ? onUnprune(nodeId) : onPrune(nodeId))}
        />
        {/* Connector line down if multiple children */}
        {visibleChildren.length > 1 && (
          <div className="w-px h-2 bg-stone-700" />
        )}
      </div>

      {/* Children */}
      {visibleChildren.length > 0 && (
        <div className="flex flex-col gap-0.5 ml-0.5">
          {/* Horizontal connector */}
          {visibleChildren.length === 1 ? (
            <div className="flex items-center">
              <div className="w-2 h-px bg-stone-700" />
              <NodeBranch
                tree={tree}
                nodeId={visibleChildren[0].id}
                onNodeSelect={onNodeSelect}
                onPrune={onPrune}
                onUnprune={onUnprune}
              />
            </div>
          ) : (
            visibleChildren.map((child, i) => (
              <div key={child.id} className="flex items-center">
                {/* Branch connector */}
                <div className="relative w-3 h-4">
                  <div className="absolute left-0 top-1/2 w-3 h-px bg-stone-700" />
                  {i === 0 && (
                    <div className="absolute left-0 top-1/2 bottom-0 w-px bg-stone-700" />
                  )}
                  {i === visibleChildren.length - 1 && (
                    <div className="absolute left-0 top-0 bottom-1/2 w-px bg-stone-700" />
                  )}
                  {i > 0 && i < visibleChildren.length - 1 && (
                    <div className="absolute left-0 top-0 bottom-0 w-px bg-stone-700" />
                  )}
                </div>
                <NodeBranch
                  tree={tree}
                  nodeId={child.id}
                  onNodeSelect={onNodeSelect}
                  onPrune={onPrune}
                  onUnprune={onUnprune}
                />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function NodeDot({
  node,
  isOnPath,
  onClick,
  onPrune,
}: {
  node: TreeNode;
  isOnPath: boolean;
  onClick: () => void;
  onPrune: () => void;
}) {
  const preview = node.content.slice(0, 40).replace(/\n/g, " ");

  const colorClass = node.pruned
    ? "bg-stone-800 border-stone-700"
    : node.status === "generating"
      ? "bg-amber-900 border-amber-700 animate-pulse"
      : node.status === "error"
        ? "bg-red-900 border-red-700"
        : node.role === "user"
          ? isOnPath
            ? "bg-blue-800 border-blue-500"
            : "bg-blue-950 border-blue-800"
          : node.role === "assistant"
            ? isOnPath
              ? "bg-emerald-800 border-emerald-500"
              : "bg-emerald-950 border-emerald-800"
            : "bg-stone-700 border-stone-500";

  return (
    <div className="group relative">
      <button
        onClick={onClick}
        className={`w-28 h-7 rounded-md border text-[10px] truncate px-1.5 transition-all ${colorClass} ${
          isOnPath ? "ring-1 ring-white/20" : ""
        } ${node.pruned ? "opacity-40" : ""} hover:brightness-125`}
        title={`${node.role}: ${preview}`}
      >
        <span className={node.pruned ? "line-through" : ""}>
          {node.role === "system"
            ? "ROOT"
            : node.status === "generating"
              ? "..."
              : preview || "(empty)"}
        </span>
      </button>

      {/* Context menu on hover */}
      {node.role !== "system" && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPrune();
          }}
          className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-stone-800 border border-stone-600 text-[8px] text-stone-500 hover:text-red-400 hover:border-red-600 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
          title={node.pruned ? "Restore" : "Prune"}
        >
          {node.pruned ? "+" : "x"}
        </button>
      )}

      {/* Source indicator */}
      {node.source === "ai-draft" && (
        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[7px] text-blue-500">
          draft
        </div>
      )}
    </div>
  );
}
