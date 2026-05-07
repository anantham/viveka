"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { Fragment } from "@/lib/workspace";
import MarkdownText from "../MarkdownText";

/**
 * Reader view — clean flowing prose for the active sequence.
 * Pure projection of Workspace fragments. No ConversationTree
 * bridge.
 *
 * - User turns rendered in slightly heavier weight; assistant turns flow
 * - Click to edit inline (raw markdown in textarea, rendered on display)
 * - Sibling navigation when branches exist (count provided by caller)
 * - Role labels are subtle, hover-to-reveal
 */

interface ReaderViewProps {
  fragments: Fragment[];
  onEdit: (fragmentId: string, content: string) => void;
  onFragmentClick: (fragmentId: string) => void;
  onSplitRange?: (fragmentId: string, charStart: number, charEnd: number) => void;
  onMoveToStage?: (fragmentId: string) => void;
  siblingCounts: Record<string, number>;
  onNavigateSibling: (fragmentId: string, direction: "prev" | "next") => void;
}

type Role = "system" | "user" | "assistant";

function roleOf(f: Fragment): Role {
  const t = f.provenance.type;
  if (t === "system") return "system";
  if (t === "ai-generated" || t === "merged" || t === "derived") return "assistant";
  return "user";
}

function provenanceColor(f: Fragment): string {
  const t = f.provenance.type;
  if (t === "ai-generated") return "border-l-blue-500/40";
  if (t === "imported") return "border-l-amber-500/40";
  if (t === "split" || t === "extracted") return "border-l-violet-500/40";
  if (t === "merged") return "border-l-teal-500/40";
  if (roleOf(f) === "assistant") return "border-l-blue-500/20";
  return "border-l-stone-500/20";
}

function provenanceLabel(f: Fragment, role: Role): string {
  const t = f.provenance.type;
  if (t === "ai-generated")
    return f.provenance.model?.split("/").pop()?.slice(0, 8) ?? "ai";
  if (t === "split") return "split";
  if (t === "imported") return "ref";
  if (t === "merged") return "merged";
  return role === "user" ? "you" : "ai";
}

export default function ReaderView({
  fragments,
  onEdit,
  onFragmentClick,
  onSplitRange,
  onMoveToStage,
  siblingCounts,
  onNavigateSibling,
}: ReaderViewProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [selectionToolbar, setSelectionToolbar] = useState<{
    fragmentId: string;
    charStart: number;
    charEnd: number;
    x: number;
    y: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const startEdit = useCallback((f: Fragment) => {
    setEditingId(f.id);
    setEditText(f.content);
  }, []);

  const saveEdit = useCallback(() => {
    if (editingId && editText !== undefined) {
      onEdit(editingId, editText);
    }
    setEditingId(null);
  }, [editingId, editText, onEdit]);

  // Detect text selection within a fragment and show floating toolbar
  const handleMouseUp = useCallback((fragmentId: string, fragmentContent: string) => {
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

    const charStart = fragmentContent.indexOf(text);
    if (charStart === -1) {
      setSelectionToolbar(null);
      return;
    }
    const charEnd = charStart + text.length;

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const containerRect = containerRef.current?.getBoundingClientRect();

    setSelectionToolbar({
      fragmentId,
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
              e.preventDefault();
              onSplitRange(
                selectionToolbar.fragmentId,
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
                onSplitRange(
                  selectionToolbar.fragmentId,
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

      {fragments.map((f) => {
        const role = roleOf(f);
        if (role === "system") return null;
        const isUser = role === "user";
        const isEditing = editingId === f.id;
        const siblings = siblingCounts[f.id] || 1;
        const isGenerating = f.status === "generating";
        const colorClass = provenanceColor(f);
        const label = provenanceLabel(f, role);

        return (
          <div key={f.id} className={`group relative border-l-2 pl-4 ${colorClass}`}>
            {/* Role / provenance indicator — subtle, hover-to-reveal */}
            <div className="absolute -left-12 top-1 text-[9px] text-stone-700 uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity">
              {label}
            </div>

            {/* Sibling navigator — appears when there are alternatives */}
            {siblings > 1 && (
              <div className="absolute -right-20 top-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => onNavigateSibling(f.id, "prev")}
                  className="text-[10px] text-stone-600 hover:text-stone-400 px-1"
                >
                  ←
                </button>
                <span className="text-[10px] text-stone-700 tabular-nums">
                  {siblings}
                </span>
                <button
                  onClick={() => onNavigateSibling(f.id, "next")}
                  className="text-[10px] text-stone-600 hover:text-stone-400 px-1"
                >
                  →
                </button>
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
            ) : f.status === "error" ? (
              <p className="text-base text-red-400/70 leading-relaxed">
                Error: {f.error || "generation failed"}
              </p>
            ) : (
              <div
                onClick={() => onFragmentClick(f.id)}
                onDoubleClick={() => startEdit(f)}
                onMouseUp={() => handleMouseUp(f.id, f.content)}
                className={`text-base leading-relaxed cursor-text ${
                  isUser
                    ? "text-stone-200 font-normal"
                    : "text-stone-400"
                }`}
                title="Select text to split · Double-click to edit"
              >
                <MarkdownText>{f.content}</MarkdownText>
              </div>
            )}

            {/* Timing — very subtle */}
            {f.timing && (
              <div className="text-[9px] text-stone-800 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {f.timing.durationMs < 1000
                  ? `${f.timing.durationMs}ms`
                  : `${(f.timing.durationMs / 1000).toFixed(1)}s`}
                {f.provenance.model && ` · ${f.provenance.model}`}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
