"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type { Workspace, Fragment, Edge } from "@/lib/workspace";
import { usePanZoom } from "@/hooks/usePanZoom";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CursorMode = "select" | "hand";

interface Position {
  x: number;
  y: number;
}

interface WorkspaceCanvasProps {
  workspace: Workspace;
  onSplitRange: (fragmentId: string, charStart: number, charEnd: number) => void;
  onMoveFragment: (fragmentId: string, toIndex: number) => void;
  onZoneTransfer: (fragmentId: string, toZone: string) => void;
  onEdit: (fragmentId: string, content: string) => void;
  onGenerate: () => void;
  onSubmitMessage: (text: string) => void;
  onSelectFragment: (fragmentId: string) => void;
  onRefresh: () => void;
  isGenerating: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NODE_WIDTH = 480;
const NODE_GAP = 20;
const STAGE_X_OFFSET = 560; // stage fragments rendered to the right

// ---------------------------------------------------------------------------
// Provenance → color
// ---------------------------------------------------------------------------

function provenanceColor(f: Fragment): string {
  switch (f.provenance.type) {
    case "ai-generated": return "border-blue-700/50 bg-stone-800/80";
    case "human-typed": return "border-blue-900/50 bg-blue-950/60";
    case "split": case "extracted": return "border-violet-700/50 bg-violet-950/30";
    case "imported": return "border-amber-700/50 bg-amber-950/30";
    case "derived": return "border-teal-700/50 bg-teal-950/30";
    case "system": return "border-stone-700/50 bg-stone-900/80";
    default: return "border-stone-700/50 bg-stone-800/80";
  }
}

function provenanceLabel(f: Fragment): string {
  switch (f.provenance.type) {
    case "ai-generated": return f.provenance.model?.split("/").pop()?.slice(0, 12) ?? "ai";
    case "human-typed": return "you";
    case "split": return "split";
    case "imported": return "ref";
    case "derived": return "alt";
    case "system": return "sys";
    default: return f.provenance.type;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function WorkspaceCanvas({
  workspace: ws,
  onSplitRange,
  onMoveFragment,
  onZoneTransfer,
  onEdit,
  onGenerate,
  onSubmitMessage,
  onSelectFragment,
  onRefresh,
  isGenerating,
}: WorkspaceCanvasProps) {
  const [cursorMode, setCursorMode] = useState<CursorMode>("select");
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [nodeHeights, setNodeHeights] = useState<Record<string, number>>({});
  const [splitToolbar, setSplitToolbar] = useState<{
    fragmentId: string;
    charStart: number;
    charEnd: number;
    x: number;
    y: number;
  } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [dragState, setDragState] = useState<{
    fragmentId: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [inputText, setInputText] = useState("");

  const viewportRef = useRef<HTMLDivElement>(null);
  const { state: panZoom, containerRef, handlers: panZoomHandlers } = usePanZoom();

  // -----------------------------------------------------------------------
  // Derived data from workspace
  // -----------------------------------------------------------------------

  // All fragments in the workspace sequence (workspace zone)
  const sequenceFragments = useMemo(
    () => ws.sequence
      .map((id) => ws.fragments[id])
      .filter((f): f is Fragment => !!f),
    [ws.sequence, ws.fragments]
  );

  // All fragments in stage
  const stageFragments = useMemo(
    () => ws.stageIds
      .map((id) => ws.fragments[id])
      .filter((f): f is Fragment => !!f),
    [ws.stageIds, ws.fragments]
  );

  // Sibling groups: for each fragment, which others share the same parent edge
  const siblingGroups = useMemo(() => {
    const groups: Record<string, string[]> = {};
    // Build parent→children map from responded-to edges
    const parentToChildren: Record<string, string[]> = {};
    for (const edge of ws.edges) {
      if (edge.type === "responded-to") {
        if (!parentToChildren[edge.from]) parentToChildren[edge.from] = [];
        parentToChildren[edge.from].push(edge.to);
      }
    }
    // For each fragment, find its siblings
    for (const [parentId, children] of Object.entries(parentToChildren)) {
      if (children.length > 1) {
        for (const childId of children) {
          groups[childId] = children;
        }
      }
    }
    return groups;
  }, [ws.edges]);

  // Fragments NOT in sequence or stage but completed (available to pick)
  const unplacedFragments = useMemo(() => {
    const inSeq = new Set(ws.sequence);
    const inStage = new Set(ws.stageIds);
    return Object.values(ws.fragments).filter(
      (f) => !inSeq.has(f.id) && !inStage.has(f.id) && f.status === "complete" && f.content && f.provenance.type !== "system"
    );
  }, [ws.fragments, ws.sequence, ws.stageIds]);

  // Generating fragments
  const generatingFragments = useMemo(
    () => Object.values(ws.fragments).filter((f) => f.status === "generating"),
    [ws.fragments]
  );

  // Edges for rendering (only between visible fragments)
  const visibleEdges = useMemo(() => {
    const visibleIds = new Set([
      ...ws.sequence,
      ...ws.stageIds,
      ...unplacedFragments.map((f) => f.id),
      ...generatingFragments.map((f) => f.id),
    ]);
    return ws.edges.filter((e) => visibleIds.has(e.from) && visibleIds.has(e.to));
  }, [ws.edges, ws.sequence, ws.stageIds, unplacedFragments, generatingFragments]);

  // -----------------------------------------------------------------------
  // Position computation
  // -----------------------------------------------------------------------

  // Initialize positions for fragments that don't have them
  useEffect(() => {
    setPositions((prev) => {
      const updated = { ...prev };
      let needsUpdate = false;
      let currentY = 40;

      // Sequence fragments — vertical column
      for (const f of sequenceFragments) {
        if (f.provenance.type === "system") continue;
        if (!prev[f.id]) {
          needsUpdate = true;
          updated[f.id] = { x: 40, y: currentY };
        }
        currentY = (prev[f.id]?.y ?? currentY) + (nodeHeights[f.id] ?? 80) + NODE_GAP;
      }

      // Stage fragments — to the right
      let stageY = 40;
      for (const f of stageFragments) {
        if (!prev[f.id]) {
          needsUpdate = true;
          updated[f.id] = { x: STAGE_X_OFFSET, y: stageY };
        }
        stageY = (prev[f.id]?.y ?? stageY) + (nodeHeights[f.id] ?? 60) + NODE_GAP;
      }

      // Unplaced fragments — below stage
      for (const f of unplacedFragments) {
        if (!prev[f.id]) {
          needsUpdate = true;
          updated[f.id] = { x: STAGE_X_OFFSET, y: stageY };
          stageY += (nodeHeights[f.id] ?? 60) + NODE_GAP;
        }
      }

      // Generating — below sequence
      for (const f of generatingFragments) {
        if (!prev[f.id]) {
          needsUpdate = true;
          updated[f.id] = { x: 40, y: currentY };
          currentY += 60 + NODE_GAP;
        }
      }

      // Use persisted canvas positions from workspace
      for (const [id, pos] of Object.entries(ws.canvasPositions)) {
        if (ws.fragments[id] && !prev[id]) {
          needsUpdate = true;
          updated[id] = pos;
        }
      }

      return needsUpdate ? updated : prev;
    });
  }, [sequenceFragments, stageFragments, unplacedFragments, generatingFragments, nodeHeights, ws.canvasPositions, ws.fragments]);

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  const handleHeightMeasured = useCallback((id: string, height: number) => {
    setNodeHeights((prev) => {
      if (prev[id] === height) return prev;
      return { ...prev, [id]: height };
    });
  }, []);

  const handlePositionChange = useCallback((id: string, pos: Position) => {
    setPositions((prev) => ({ ...prev, [id]: pos }));
  }, []);

  // Text selection → split toolbar
  const handleTextMouseUp = useCallback((fragmentId: string, content: string) => {
    if (cursorMode !== "select") return;
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
    const charStart = content.indexOf(text);
    if (charStart === -1) {
      setSplitToolbar(null);
      return;
    }
    const charEnd = charStart + text.length;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return;

    setSplitToolbar({
      fragmentId,
      charStart,
      charEnd,
      x: (rect.left + rect.width / 2 - containerRect.left - panZoom.panX) / panZoom.zoom,
      y: (rect.top - containerRect.top - panZoom.panY) / panZoom.zoom - 8,
    });
  }, [cursorMode, panZoom, containerRef]);

  // Node drag (hand mode)
  const handlePointerDown = useCallback((e: React.PointerEvent, fragmentId: string) => {
    if (cursorMode !== "hand") return;
    if (editingId) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    setDragState({
      fragmentId,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    });
    el.setPointerCapture(e.pointerId);
  }, [cursorMode, editingId]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState) return;
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const newX = (e.clientX - rect.left - dragState.offsetX) / panZoom.zoom;
    const newY = (e.clientY - rect.top - dragState.offsetY) / panZoom.zoom;
    handlePositionChange(dragState.fragmentId, { x: newX, y: newY });
  }, [dragState, panZoom.zoom, containerRef, handlePositionChange]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (dragState) {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      setDragState(null);
    }
  }, [dragState]);

  // Inline edit
  const startEdit = useCallback((f: Fragment) => {
    setEditingId(f.id);
    setEditText(f.content);
  }, []);

  const saveEdit = useCallback(() => {
    if (editingId) {
      onEdit(editingId, editText);
      setEditingId(null);
    }
  }, [editingId, editText, onEdit]);

  // Send message
  const handleSend = useCallback(() => {
    if (!inputText.trim()) return;
    onSubmitMessage(inputText.trim());
    setInputText("");
  }, [inputText, onSubmitMessage]);

  // -----------------------------------------------------------------------
  // Render a single fragment node
  // -----------------------------------------------------------------------

  const renderFragment = useCallback((f: Fragment, zone: "workspace" | "stage" | "unplaced") => {
    const pos = positions[f.id];
    if (!pos) return null;
    if (f.provenance.type === "system") return null;

    const isEditing = editingId === f.id;
    const isInSequence = ws.sequence.includes(f.id);
    const siblings = siblingGroups[f.id];
    const seqIndex = ws.sequence.indexOf(f.id);
    const color = provenanceColor(f);
    const label = provenanceLabel(f);
    const isGen = f.status === "generating";

    return (
      <div
        key={f.id}
        ref={(el) => {
          if (el) {
            const h = el.getBoundingClientRect().height / panZoom.zoom;
            if (Math.abs(h - (nodeHeights[f.id] ?? 0)) > 2) {
              handleHeightMeasured(f.id, h);
            }
          }
        }}
        className={`absolute ${cursorMode === "hand" ? "cursor-grab active:cursor-grabbing select-none" : "cursor-text"}`}
        style={{
          left: pos.x,
          top: pos.y,
          width: NODE_WIDTH,
          zIndex: dragState?.fragmentId === f.id ? 50 : 1,
          opacity: zone === "unplaced" ? 0.5 : zone === "stage" ? 0.7 : 1,
        }}
        onPointerDown={(e) => handlePointerDown(e, f.id)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={() => cursorMode === "select" && startEdit(f)}
      >
        <div className={`rounded-xl border px-4 py-3 text-sm leading-relaxed transition-all ${color} ${isGen ? "animate-pulse" : ""}`}>
          {/* Header: provenance label + sequence badge + siblings */}
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] uppercase tracking-wider text-stone-500">
              {label}
              {f.timing && (
                <span className="ml-2 text-stone-700">
                  {f.timing.durationMs < 1000
                    ? `${f.timing.durationMs}ms`
                    : `${(f.timing.durationMs / 1000).toFixed(1)}s`}
                </span>
              )}
            </span>
            <div className="flex items-center gap-2">
              {siblings && siblings.length > 1 && (
                <span className="text-[10px] text-stone-600">
                  {siblings.indexOf(f.id) + 1}/{siblings.length}
                </span>
              )}
              {isInSequence && (
                <span className="bg-stone-600 text-stone-200 text-[10px] font-mono rounded-full w-5 h-5 flex items-center justify-center">
                  {seqIndex + 1}
                </span>
              )}
              {!isInSequence && zone === "unplaced" && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectFragment(f.id);
                  }}
                  className="text-[10px] px-1.5 py-0.5 bg-blue-900/50 text-blue-300 rounded hover:bg-blue-800/50"
                >
                  pick
                </button>
              )}
              {zone === "workspace" && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onZoneTransfer(f.id, "stage");
                  }}
                  className="text-[10px] px-1 text-stone-600 hover:text-stone-400 opacity-0 group-hover:opacity-100"
                >
                  stage
                </button>
              )}
            </div>
          </div>

          {/* Content */}
          {isEditing ? (
            <div onClick={(e) => e.stopPropagation()}>
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setEditingId(null);
                  if (e.key === "Enter" && e.metaKey) saveEdit();
                }}
                className="w-full bg-stone-900 border border-stone-600 rounded px-2 py-1 text-sm text-stone-200 focus:outline-none focus:border-stone-400 resize-y min-h-[60px]"
                rows={4}
                autoFocus
              />
              <div className="flex gap-2 mt-1">
                <button onClick={saveEdit} className="text-xs px-2 py-0.5 bg-stone-700 rounded text-stone-300 hover:bg-stone-600">Save</button>
                <button onClick={() => setEditingId(null)} className="text-xs text-stone-600 hover:text-stone-400">Cancel</button>
              </div>
            </div>
          ) : isGen ? (
            <div className="text-stone-500">Generating...</div>
          ) : f.status === "error" ? (
            <div className="text-red-400 text-xs">Error: {f.error || "failed"}</div>
          ) : (
            <div
              className="whitespace-pre-wrap select-text text-stone-200"
              onMouseUp={() => handleTextMouseUp(f.id, f.content)}
            >
              {f.content}
            </div>
          )}
        </div>
      </div>
    );
  }, [positions, nodeHeights, panZoom.zoom, cursorMode, editingId, editText, dragState, ws.sequence, siblingGroups, handlePointerDown, handlePointerMove, handlePointerUp, handleHeightMeasured, handleTextMouseUp, startEdit, saveEdit, onSelectFragment, onZoneTransfer]);

  // -----------------------------------------------------------------------
  // Render edges as SVG lines
  // -----------------------------------------------------------------------

  const edgeLines = useMemo(() => {
    return visibleEdges.map((edge, i) => {
      const fromPos = positions[edge.from];
      const toPos = positions[edge.to];
      if (!fromPos || !toPos) return null;
      const fromH = nodeHeights[edge.from] ?? 80;
      const x1 = fromPos.x + NODE_WIDTH / 2;
      const y1 = fromPos.y + fromH;
      const x2 = toPos.x + NODE_WIDTH / 2;
      const y2 = toPos.y;
      const isActive = ws.sequence.includes(edge.from) && ws.sequence.includes(edge.to);
      return (
        <line
          key={`edge-${i}`}
          x1={x1} y1={y1} x2={x2} y2={y2}
          stroke={isActive ? "rgba(168, 162, 158, 0.3)" : "rgba(168, 162, 158, 0.1)"}
          strokeWidth={isActive ? 2 : 1}
          strokeDasharray={isActive ? "none" : "4 4"}
        />
      );
    });
  }, [visibleEdges, positions, nodeHeights, ws.sequence]);

  // -----------------------------------------------------------------------
  // Keyboard shortcuts
  // -----------------------------------------------------------------------

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === " " && !editingId) {
        e.preventDefault();
        setCursorMode((m) => m === "hand" ? "select" : "hand");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editingId]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div ref={viewportRef} className="w-full h-full relative overflow-hidden bg-stone-950">
      {/* Toolbar */}
      <div className="absolute top-3 left-3 z-40 flex gap-2">
        <button
          onClick={() => setCursorMode("select")}
          className={`text-xs px-2 py-1 rounded border transition-colors ${
            cursorMode === "select"
              ? "border-stone-500 text-stone-300 bg-stone-800"
              : "border-stone-700 text-stone-600 hover:text-stone-400"
          }`}
        >
          I Select
        </button>
        <button
          onClick={() => setCursorMode("hand")}
          className={`text-xs px-2 py-1 rounded border transition-colors ${
            cursorMode === "hand"
              ? "border-stone-500 text-stone-300 bg-stone-800"
              : "border-stone-700 text-stone-600 hover:text-stone-400"
          }`}
        >
          ✋ Move
        </button>
      </div>

      {/* Stats */}
      <div className="absolute top-3 right-3 z-40 text-[10px] text-stone-700">
        {sequenceFragments.length} in workspace · {stageFragments.length} staged · {unplacedFragments.length} unplaced · {generatingFragments.length} generating
      </div>

      {/* Stage zone label */}
      {(stageFragments.length > 0 || unplacedFragments.length > 0) && (
        <div
          className="absolute z-30 text-[10px] text-stone-600 uppercase tracking-widest"
          style={{
            left: STAGE_X_OFFSET * panZoom.zoom + panZoom.panX,
            top: 20 * panZoom.zoom + panZoom.panY,
          }}
        >
          stage / unplaced
        </div>
      )}

      {/* Pan/zoom canvas */}
      <div
        ref={containerRef}
        className="w-full h-full"
        style={{ cursor: cursorMode === "hand" ? "grab" : "text" }}
        {...panZoomHandlers}
      >
        <div
          style={{
            transform: `translate(${panZoom.panX}px, ${panZoom.panY}px) scale(${panZoom.zoom})`,
            transformOrigin: "0 0",
          }}
        >
          {/* Edge lines */}
          <svg className="absolute top-0 left-0 w-full h-full pointer-events-none" style={{ overflow: "visible" }}>
            {edgeLines}
          </svg>

          {/* Split toolbar */}
          {splitToolbar && (
            <div
              className="absolute z-50 flex gap-1 bg-stone-800 border border-stone-600 rounded-lg shadow-xl px-1.5 py-1 -translate-x-1/2 -translate-y-full pointer-events-auto"
              style={{ left: splitToolbar.x, top: splitToolbar.y }}
            >
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSplitRange(splitToolbar.fragmentId, splitToolbar.charStart, splitToolbar.charEnd);
                  setSplitToolbar(null);
                  window.getSelection()?.removeAllRanges();
                  onRefresh();
                }}
                className="text-xs px-2 py-0.5 text-stone-300 hover:bg-stone-700 rounded"
              >
                split
              </button>
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  onZoneTransfer(splitToolbar.fragmentId, "stage");
                  setSplitToolbar(null);
                  window.getSelection()?.removeAllRanges();
                  onRefresh();
                }}
                className="text-xs px-2 py-0.5 text-stone-300 hover:bg-stone-700 rounded"
              >
                stage
              </button>
            </div>
          )}

          {/* Workspace fragments (in sequence) */}
          {sequenceFragments.map((f) => renderFragment(f, "workspace"))}

          {/* Stage fragments */}
          {stageFragments.map((f) => renderFragment(f, "stage"))}

          {/* Unplaced fragments (completed but not in sequence) */}
          {unplacedFragments.map((f) => renderFragment(f, "unplaced"))}

          {/* Generating fragments */}
          {generatingFragments.map((f) => renderFragment(f, "workspace"))}
        </div>
      </div>

      {/* Input bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-stone-900/90 border-t border-stone-800 p-3 flex gap-2">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSend();
          }}
          placeholder="Type a message..."
          className="flex-1 bg-stone-800 border border-stone-700 rounded px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:border-stone-500"
        />
        <button
          onClick={handleSend}
          disabled={!inputText.trim() || isGenerating}
          className="px-4 py-2 text-sm bg-stone-700 rounded text-stone-300 hover:bg-stone-600 disabled:opacity-30"
        >
          Send
        </button>
        <button
          onClick={onGenerate}
          disabled={isGenerating}
          className="px-3 py-2 text-xs border border-stone-700 rounded text-stone-500 hover:text-stone-300 disabled:opacity-30"
        >
          {isGenerating ? "generating..." : "↻ reroll"}
        </button>
      </div>
    </div>
  );
}
