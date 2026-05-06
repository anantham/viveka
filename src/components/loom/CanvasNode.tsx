"use client";

import { useRef, useState, useCallback } from "react";
import { TreeNode } from "@/lib/tree";
import { CursorTool } from "@/lib/canvas-utils";
import VersionHistory from "./VersionHistory";

interface CanvasNodeProps {
  node: TreeNode;
  position: { x: number; y: number };
  onPositionChange: (id: string, pos: { x: number; y: number }) => void;
  onHeightMeasured: (id: string, height: number) => void;
  inContext: boolean;
  isAnimating: boolean;
  cursorTool: CursorTool;
  nodeWidth: number;
  zoom: number;
  treeId?: string;
  onTextDragStart?: (nodeId: string, text: string, sourceRange: { start: number; end: number }) => void;
  onTextDrop?: (targetNodeId: string, insertPosition: number, text: string) => void;
  onEdit?: (nodeId: string, content: string) => void;
  onContentReorder?: (nodeId: string, newContent: string) => void;
  onRerollComplete?: () => void;
  onTangentSplit?: (nodeId: string, charPosition: number) => void;
  onVersionRevert?: (nodeId: string, content: string) => void;
  onSplitRange?: (nodeId: string, charStart: number, charEnd: number) => void;
}

export default function CanvasNode({
  node,
  position,
  onPositionChange,
  onHeightMeasured,
  inContext,
  isAnimating,
  cursorTool,
  nodeWidth,
  zoom,
  treeId,
  onTextDragStart,
  onTextDrop,
  onEdit,
  onContentReorder,
  onRerollComplete,
  onTangentSplit,
  onVersionRevert,
  onSplitRange,
}: CanvasNodeProps) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const isDraggingNode = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(node.content);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isRerolling, setIsRerolling] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [splitToolbar, setSplitToolbar] = useState<{
    charStart: number;
    charEnd: number;
    x: number;
    y: number;
  } | null>(null);
  const rerollDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Measure height after render
  const measuredRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (el) {
        const height = el.getBoundingClientRect().height;
        onHeightMeasured(node.id, height / zoom);
      }
    },
    [node.id, onHeightMeasured, zoom]
  );

  // --- Node dragging (Hand mode, drag the whole node) ---
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (cursorTool !== "hand") return;
      if (isEditing) return;

      e.preventDefault();
      e.stopPropagation();

      isDraggingNode.current = true;
      const rect = nodeRef.current!.getBoundingClientRect();
      dragOffset.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [cursorTool, isEditing]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDraggingNode.current) return;
      e.preventDefault();

      // Parent container's transform includes zoom, so we need to account for it
      const container = nodeRef.current?.parentElement;
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      const newX = (e.clientX - containerRect.left - dragOffset.current.x) / zoom;
      const newY = (e.clientY - containerRect.top - dragOffset.current.y) / zoom;

      onPositionChange(node.id, { x: newX, y: newY });
    },
    [node.id, onPositionChange, zoom]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (isDraggingNode.current) {
        isDraggingNode.current = false;
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      }
    },
    []
  );

  // --- Text snippet dragging (Select mode → Hand mode drag) ---
  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      if (cursorTool !== "hand") return;

      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) {
        // No text selected — drag the whole node instead (handled by pointer events)
        e.preventDefault();
        return;
      }

      const selectedText = selection.toString();
      e.dataTransfer.setData("text/plain", selectedText);
      e.dataTransfer.setData(
        "application/x-viveka-snippet",
        JSON.stringify({
          sourceNodeId: node.id,
          text: selectedText,
        })
      );

      if (onTextDragStart) {
        const range = selection.getRangeAt(0);
        const fullText = node.content;
        const start = fullText.indexOf(selectedText);
        const end = start + selectedText.length;
        onTextDragStart(node.id, selectedText, { start, end });
      }
    },
    [cursorTool, node.id, node.content, onTextDragStart]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);

      const snippetData = e.dataTransfer.getData("application/x-viveka-snippet");
      if (!snippetData) return;

      const { text } = JSON.parse(snippetData);
      // Insert at end for now — phase 2 will use cursor position within text
      if (onTextDrop) {
        onTextDrop(node.id, node.content.length, text);
      }
    },
    [node.id, node.content.length, onTextDrop]
  );

  // --- Phrase reroll on arrow keys (Select mode with active text selection) ---
  // Design: scroll always cycles tools. Arrow ↑↓ with selection = reroll.
  const handleRerollKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (cursorTool !== "select") return;
      if (isEditing || isRerolling) return;
      if (!treeId) return;
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;

      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return;

      const selectedText = selection.toString().trim();
      if (selectedText.length < 2) return;

      // Verify the selection is within this node
      const anchorEl = selection.anchorNode?.parentElement?.closest("[data-node-id]");
      if (anchorEl?.getAttribute("data-node-id") !== node.id) return;

      // Prevent default arrow behavior (cursor movement)
      e.preventDefault();
      e.stopPropagation();

      // Debounce
      if (rerollDebounceRef.current) {
        clearTimeout(rerollDebounceRef.current);
      }

      rerollDebounceRef.current = setTimeout(async () => {
        setIsRerolling(true);
        try {
          const res = await fetch("/api/tree/reroll-phrase", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              treeId,
              nodeId: node.id,
              selectedText,
              fullContent: node.content,
              count: 5,
            }),
          });
          const data = await res.json();
          if (data.error) {
            console.error("[viveka-loom] reroll-phrase error:", data.error);
          } else {
            selection.removeAllRanges();
            onRerollComplete?.();
          }
        } catch (err) {
          console.error("[viveka-loom] reroll-phrase fetch error:", err);
        } finally {
          setIsRerolling(false);
        }
      }, 300);
    },
    [cursorTool, isEditing, isRerolling, treeId, node.id, node.content, onRerollComplete]
  );

  // --- Text selection → split toolbar (Select mode) ---
  const handleTextMouseUp = useCallback(() => {
    if (cursorTool !== "select" || isEditing) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      setSplitToolbar(null);
      return;
    }
    const text = sel.toString().trim();
    if (!text || text.length < 2) {
      setSplitToolbar(null);
      return;
    }
    const charStart = node.content.indexOf(text);
    if (charStart === -1) {
      setSplitToolbar(null);
      return;
    }
    const charEnd = charStart + text.length;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const nodeRect = nodeRef.current?.getBoundingClientRect();
    if (!nodeRect) return;
    setSplitToolbar({
      charStart,
      charEnd,
      x: rect.left + rect.width / 2 - nodeRect.left,
      y: rect.top - nodeRect.top - 8,
    });
  }, [cursorTool, isEditing, node.content]);

  // --- Inline editing ---
  const handleDoubleClick = useCallback(() => {
    if (cursorTool === "select") {
      setIsEditing(true);
      setEditText(node.content);
    }
  }, [cursorTool, node.content]);

  const handleEditSave = useCallback(() => {
    if (onEdit && editText !== node.content) {
      onEdit(node.id, editText);
    }
    setIsEditing(false);
  }, [node.id, editText, node.content, onEdit]);

  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsEditing(false);
        setEditText(node.content);
      }
      if (e.key === "Enter" && e.metaKey) {
        handleEditSave();
      }
    },
    [node.content, handleEditSave]
  );

  // --- Tangent mode: click to split node mid-text ---
  const handleTangentClick = useCallback(
    (e: React.MouseEvent) => {
      if (cursorTool !== "tangent") return;
      if (isEditing) return;
      if (!onTangentSplit) return;
      if (!node.content || node.content.length < 2) return;

      e.preventDefault();
      e.stopPropagation();

      // Determine character position at click point using caretRangeFromPoint / caretPositionFromPoint
      let charOffset: number | null = null;

      if (document.caretRangeFromPoint) {
        // Chrome, Safari, Edge
        const range = document.caretRangeFromPoint(e.clientX, e.clientY);
        if (range) {
          // Walk up to find the content container (the whitespace-pre-wrap div)
          const container = (e.currentTarget as HTMLElement).querySelector(".whitespace-pre-wrap");
          if (container && container.contains(range.startContainer)) {
            // Calculate total offset within the text content
            const treeWalker = document.createTreeWalker(
              container,
              NodeFilter.SHOW_TEXT,
              null
            );
            let offset = 0;
            let textNode = treeWalker.nextNode();
            while (textNode) {
              if (textNode === range.startContainer) {
                offset += range.startOffset;
                break;
              }
              offset += (textNode.textContent?.length ?? 0);
              textNode = treeWalker.nextNode();
            }
            charOffset = offset;
          }
        }
      } else if ((document as unknown as { caretPositionFromPoint: (x: number, y: number) => { offsetNode: Node; offset: number } | null }).caretPositionFromPoint) {
        // Firefox
        const caretPos = (document as unknown as { caretPositionFromPoint: (x: number, y: number) => { offsetNode: Node; offset: number } | null }).caretPositionFromPoint(e.clientX, e.clientY);
        if (caretPos) {
          const container = (e.currentTarget as HTMLElement).querySelector(".whitespace-pre-wrap");
          if (container && container.contains(caretPos.offsetNode)) {
            const treeWalker = document.createTreeWalker(
              container,
              NodeFilter.SHOW_TEXT,
              null
            );
            let offset = 0;
            let textNode = treeWalker.nextNode();
            while (textNode) {
              if (textNode === caretPos.offsetNode) {
                offset += caretPos.offset;
                break;
              }
              offset += (textNode.textContent?.length ?? 0);
              textNode = treeWalker.nextNode();
            }
            charOffset = offset;
          }
        }
      }

      if (charOffset !== null && charOffset > 0 && charOffset < node.content.length) {
        onTangentSplit(node.id, charOffset);
      }
    },
    [cursorTool, isEditing, onTangentSplit, node.id, node.content]
  );

  // Skip system nodes
  if (node.role === "system") return null;

  const isUser = node.role === "user";
  const isGenerating = node.status === "generating";

  const cursorClass =
    cursorTool === "hand"
      ? "cursor-grab active:cursor-grabbing"
      : cursorTool === "select"
        ? "cursor-text"
        : "cursor-crosshair";

  return (
    <div
      ref={(el) => {
        (nodeRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
        measuredRef(el);
      }}
      data-node-id={node.id}
      tabIndex={0}
      className={`absolute ${cursorTool === "hand" ? "select-none" : "select-auto"} ${cursorClass} focus:outline-none`}
      style={{
        left: position.x,
        top: position.y,
        width: nodeWidth,
        transition: isAnimating ? "left 400ms ease-out, top 400ms ease-out, width 400ms ease-out" : "none",
        zIndex: isDraggingNode.current ? 50 : 1,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={handleTangentClick}
      onDoubleClick={handleDoubleClick}
      draggable={cursorTool === "hand"}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onKeyDown={handleRerollKeyDown}
    >
      <div
        className={`rounded-xl border px-4 py-3 text-sm leading-relaxed transition-all ${
          isUser
            ? "bg-blue-950/60 border-blue-800/50 text-blue-100"
            : "bg-stone-800/80 border-stone-700/50 text-stone-200"
        } ${
          inContext
            ? "opacity-100"
            : "opacity-40 saturate-50"
        } ${
          isDragOver
            ? "ring-2 ring-amber-500/50 border-amber-500/50"
            : ""
        } ${
          isGenerating || isRerolling ? "animate-pulse" : ""
        }`}
      >
        {/* Role label */}
        <div
          className={`text-[10px] uppercase tracking-wider mb-1 ${
            isUser ? "text-blue-400/70" : "text-stone-500"
          }`}
        >
          {isUser ? "human" : "assistant"}
          {node.version > 1 && (
            <span className="relative ml-2 inline-block">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setShowVersionHistory((v) => !v);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className="text-stone-500 hover:text-amber-400 hover:bg-stone-700/50 px-1 rounded transition-colors cursor-pointer font-mono"
                title={`Version ${node.version} — click for history`}
              >
                v{node.version}
              </button>
              {showVersionHistory && (
                <VersionHistory
                  node={node}
                  onRevert={(nodeId, content) => {
                    if (onVersionRevert) {
                      onVersionRevert(nodeId, content);
                    } else if (onEdit) {
                      onEdit(nodeId, content);
                    }
                  }}
                  onClose={() => setShowVersionHistory(false)}
                />
              )}
            </span>
          )}
          {isRerolling && (
            <span className="ml-2 text-amber-500 animate-pulse">rerolling...</span>
          )}
        </div>

        {/* Content */}
        {isEditing ? (
          <div onClick={(e) => e.stopPropagation()}>
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={handleEditKeyDown}
              className="w-full bg-stone-900 border border-stone-600 rounded px-2 py-1 text-sm text-stone-200 focus:outline-none focus:border-stone-400 resize-y min-h-[60px]"
              rows={4}
              autoFocus
            />
            <div className="flex gap-2 mt-1">
              <button
                onClick={handleEditSave}
                className="text-xs px-2 py-0.5 bg-stone-700 rounded text-stone-300 hover:bg-stone-600"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setIsEditing(false);
                  setEditText(node.content);
                }}
                className="text-xs text-stone-600 hover:text-stone-400"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : isGenerating ? (
          <div className="text-stone-500">Generating...</div>
        ) : node.status === "error" ? (
          <div className="text-red-400">Error: {node.error || "generation failed"}</div>
        ) : (
          <div className="whitespace-pre-wrap select-text" onMouseUp={handleTextMouseUp}>{node.content}</div>
        )}
      </div>

      {/* Split toolbar — appears on text selection in select mode */}
      {splitToolbar && onSplitRange && (
        <div
          className="absolute z-50 flex gap-1 bg-stone-800 border border-stone-600 rounded-lg shadow-xl px-1.5 py-1 -translate-x-1/2 -translate-y-full pointer-events-auto"
          style={{
            left: splitToolbar.x,
            top: splitToolbar.y,
          }}
        >
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onSplitRange(node.id, splitToolbar.charStart, splitToolbar.charEnd);
              setSplitToolbar(null);
              window.getSelection()?.removeAllRanges();
            }}
            className="text-xs px-2 py-0.5 text-stone-300 hover:bg-stone-700 rounded transition-colors"
          >
            split
          </button>
        </div>
      )}

      {/* Reading order badge */}
      {inContext && (
        <div className="absolute -top-2 -left-2 bg-stone-700 text-stone-300 text-[10px] rounded-full w-5 h-5 flex items-center justify-center font-mono">
          {/* Populated by parent via data attribute or prop — placeholder */}
        </div>
      )}
    </div>
  );
}
