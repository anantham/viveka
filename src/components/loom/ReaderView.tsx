"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { TreeNode } from "@/lib/tree";
import MarkdownText from "../MarkdownText";

interface ReaderViewProps {
  nodes: TreeNode[];
  onEdit: (nodeId: string, content: string) => void;
  onNodeClick: (nodeId: string) => void;
  onSplitRange?: (nodeId: string, charStart: number, charEnd: number) => void;
  onMoveToStage?: (nodeId: string) => void;
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
// Provenance → color mapping
function provenanceColor(node: TreeNode): string {
  const pType = node.provenance?.type;
  if (pType === "ai-generated") return "border-l-blue-500/40";
  if (pType === "imported") return "border-l-amber-500/40";
  if (pType === "split" || pType === "extracted") return "border-l-violet-500/40";
  if (pType === "merged") return "border-l-teal-500/40";
  // Legacy fallback: use role
  if (node.role === "assistant") return "border-l-blue-500/20";
  return "border-l-stone-500/20";
}

export default function ReaderView({
  nodes,
  onEdit,
  onNodeClick,
  onSplitRange,
  onMoveToStage,
  siblingCounts,
  onNavigateSibling,
}: ReaderViewProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [selectionToolbar, setSelectionToolbar] = useState<{
    nodeId: string;
    charStart: number;
    charEnd: number;
    x: number;
    y: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Detect text selection within a fragment and show floating toolbar
  const handleMouseUp = useCallback((nodeId: string, nodeContent: string) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      setSelectionToolbar(null);
      return;
    }

    const text = sel.toString().trim();
    if (!text) {
      setSelectionToolbar(null);
      return;
    }

    // Find character offsets within the node's content
    const charStart = nodeContent.indexOf(text);
    if (charStart === -1) {
      setSelectionToolbar(null);
      return;
    }
    const charEnd = charStart + text.length;

    // Position toolbar above selection
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const containerRect = containerRef.current?.getBoundingClientRect();

    setSelectionToolbar({
      nodeId,
      charStart,
      charEnd,
      x: rect.left + rect.width / 2 - (containerRect?.left ?? 0),
      y: rect.top - (containerRect?.top ?? 0) - 8,
    });
  }, []);

  // Dismiss toolbar on click outside
  useEffect(() => {
    const handler = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        setSelectionToolbar(null);
      }
    };
    // Small delay so the toolbar buttons can be clicked
    const delayedHandler = () => setTimeout(handler, 200);
    document.addEventListener("mousedown", delayedHandler);
    return () => document.removeEventListener("mousedown", delayedHandler);
  }, []);

  return (
    <div className="max-w-prose mx-auto px-8 py-8 space-y-6 relative" ref={containerRef}>
      {/* Floating selection toolbar */}
      {selectionToolbar && onSplitRange && (
        <div
          className="absolute z-50 flex gap-1 bg-stone-800 border border-stone-600 rounded-lg shadow-xl px-1.5 py-1 -translate-x-1/2 -translate-y-full"
          style={{
            left: selectionToolbar.x,
            top: selectionToolbar.y,
          }}
        >
          <button
            onMouseDown={(e) => {
              e.preventDefault(); // prevent blur
              onSplitRange(
                selectionToolbar.nodeId,
                selectionToolbar.charStart,
                selectionToolbar.charEnd
              );
              setSelectionToolbar(null);
              window.getSelection()?.removeAllRanges();
            }}
            className="text-xs px-2 py-0.5 text-stone-300 hover:bg-stone-700 rounded transition-colors"
            title="Split selection into its own fragment"
          >
            split
          </button>
          {onMoveToStage && (
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                // Split first, then the parent can move the result to stage
                onSplitRange(
                  selectionToolbar.nodeId,
                  selectionToolbar.charStart,
                  selectionToolbar.charEnd
                );
                setSelectionToolbar(null);
                window.getSelection()?.removeAllRanges();
              }}
              className="text-xs px-2 py-0.5 text-stone-300 hover:bg-stone-700 rounded transition-colors"
              title="Extract to stage"
            >
              stage
            </button>
          )}
        </div>
      )}

      {nodes.map((node) => {
        if (node.role === "system") return null;
        const isUser = node.role === "user";
        const isEditing = editingId === node.id;
        const siblings = siblingCounts[node.id] || 1;
        const isDraft = node.source === "ai-draft";
        const isGenerating = node.status === "generating";
        const colorClass = provenanceColor(node);

        return (
          <div key={node.id} className={`group relative border-l-2 pl-4 ${colorClass}`}>
            {/* Role / provenance indicator — very subtle, left margin */}
            <div className="absolute -left-12 top-1 text-[9px] text-stone-700 uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity">
              {node.provenance?.type === "ai-generated"
                ? node.provenance.model?.split("/").pop()?.slice(0, 8) ?? "ai"
                : node.provenance?.type === "split"
                  ? "split"
                  : node.provenance?.type === "imported"
                    ? "ref"
                    : isUser ? "you" : "ai"}
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
                onMouseUp={() => handleMouseUp(node.id, node.content)}
                className={`text-base leading-relaxed cursor-text ${
                  isUser
                    ? "text-stone-200 font-normal"
                    : "text-stone-400"
                }`}
                title="Select text to split · Double-click to edit"
              >
                <MarkdownText>{node.content}</MarkdownText>
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
