"use client";

import { useRef, useState, useCallback } from "react";
import { TreeNode } from "@/lib/tree";
import { CursorTool } from "@/lib/canvas-utils";

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
  onTextDragStart?: (nodeId: string, text: string, sourceRange: { start: number; end: number }) => void;
  onTextDrop?: (targetNodeId: string, insertPosition: number, text: string) => void;
  onEdit?: (nodeId: string, content: string) => void;
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
  onTextDragStart,
  onTextDrop,
  onEdit,
}: CanvasNodeProps) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const isDraggingNode = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(node.content);
  const [isDragOver, setIsDragOver] = useState(false);

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
      className={`absolute select-none ${cursorClass}`}
      style={{
        left: position.x,
        top: position.y,
        width: nodeWidth,
        transition: isAnimating ? "left 400ms ease-out, top 400ms ease-out" : "none",
        zIndex: isDraggingNode.current ? 50 : 1,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={handleDoubleClick}
      draggable={cursorTool === "hand"}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
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
          isGenerating ? "animate-pulse" : ""
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
            <span className="ml-2 text-stone-600">v{node.version}</span>
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
          <div className="whitespace-pre-wrap select-text">{node.content}</div>
        )}
      </div>

      {/* Reading order badge */}
      {inContext && (
        <div className="absolute -top-2 -left-2 bg-stone-700 text-stone-300 text-[10px] rounded-full w-5 h-5 flex items-center justify-center font-mono">
          {/* Populated by parent via data attribute or prop — placeholder */}
        </div>
      )}
    </div>
  );
}
