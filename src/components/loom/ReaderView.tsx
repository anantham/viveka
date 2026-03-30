"use client";

import { useState, useCallback } from "react";
import { TreeNode } from "@/lib/tree";

interface ReaderViewProps {
  nodes: TreeNode[];
  onEdit: (nodeId: string, content: string) => void;
  onNodeClick: (nodeId: string) => void;
  siblingCounts: Record<string, number>;
  onNavigateSibling: (nodeId: string, direction: "prev" | "next") => void;
}

/**
 * Reader view — clean flowing text for the active path.
 * Not bubbles. Not chat. A document you can read and refine.
 *
 * - User turns rendered in a slightly different weight
 * - Assistant turns flow naturally
 * - Click to edit inline
 * - Sibling navigation inline where branches exist
 * - Role labels are subtle, not loud
 */
export default function ReaderView({
  nodes,
  onEdit,
  onNodeClick,
  siblingCounts,
  onNavigateSibling,
}: ReaderViewProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const startEdit = useCallback((node: TreeNode) => {
    setEditingId(node.id);
    setEditText(node.content);
  }, []);

  const saveEdit = useCallback(() => {
    if (editingId && editText !== undefined) {
      onEdit(editingId, editText);
    }
    setEditingId(null);
  }, [editingId, editText, onEdit]);

  return (
    <div className="max-w-prose mx-auto px-8 py-8 space-y-6">
      {nodes.map((node) => {
        if (node.role === "system") return null;
        const isUser = node.role === "user";
        const isEditing = editingId === node.id;
        const siblings = siblingCounts[node.id] || 1;
        const isDraft = node.source === "ai-draft";
        const isGenerating = node.status === "generating";

        return (
          <div key={node.id} className="group relative">
            {/* Role indicator — very subtle, left margin */}
            <div className="absolute -left-8 top-1 text-[9px] text-stone-700 uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity">
              {isUser ? "you" : "ai"}
            </div>

            {/* Sibling navigator — appears when there are alternatives */}
            {siblings > 1 && (
              <div className="absolute -right-20 top-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => onNavigateSibling(node.id, "prev")}
                  className="text-[10px] text-stone-600 hover:text-stone-400 px-1"
                >
                  ←
                </button>
                <span className="text-[10px] text-stone-700 tabular-nums">
                  {siblings}
                </span>
                <button
                  onClick={() => onNavigateSibling(node.id, "next")}
                  className="text-[10px] text-stone-600 hover:text-stone-400 px-1"
                >
                  →
                </button>
              </div>
            )}

            {/* Draft indicator */}
            {isDraft && (
              <div className="text-[9px] text-blue-600 uppercase tracking-wider mb-1">
                draft
              </div>
            )}

            {/* Content */}
            {isEditing ? (
              <div>
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setEditingId(null);
                    if (e.key === "Enter" && e.metaKey) saveEdit();
                  }}
                  className="w-full bg-stone-900/50 border border-stone-700 rounded px-3 py-2 text-base text-stone-200 leading-relaxed focus:outline-none focus:border-stone-500 resize-y min-h-[80px]"
                  rows={4}
                  autoFocus
                />
                <div className="flex gap-2 mt-1">
                  <button
                    onClick={saveEdit}
                    className="text-xs px-2 py-0.5 bg-stone-700 rounded text-stone-300 hover:bg-stone-600"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="text-xs text-stone-600 hover:text-stone-400"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : isGenerating ? (
              <p className="text-base text-stone-600 animate-pulse leading-relaxed">
                Generating...
              </p>
            ) : node.status === "error" ? (
              <p className="text-base text-red-400/70 leading-relaxed">
                Error: {node.error || "generation failed"}
              </p>
            ) : (
              <div
                onClick={() => onNodeClick(node.id)}
                onDoubleClick={() => startEdit(node)}
                className={`text-base leading-relaxed cursor-text whitespace-pre-wrap ${
                  isUser
                    ? "text-stone-200 font-normal"
                    : "text-stone-400"
                }`}
                title="Double-click to edit"
              >
                {node.content}
              </div>
            )}

            {/* Timing — very subtle */}
            {node.timing && (
              <div className="text-[9px] text-stone-800 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {node.timing.durationMs < 1000
                  ? `${node.timing.durationMs}ms`
                  : `${(node.timing.durationMs / 1000).toFixed(1)}s`}
                {node.model && ` · ${node.model}`}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
