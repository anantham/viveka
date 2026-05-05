"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type { Workspace, Fragment, Edge } from "@/lib/workspace";
import { usePanZoom } from "@/hooks/usePanZoom";
import { usePhysicsSimulation, angleToMergeType } from "@/hooks/usePhysicsSimulation";
import type { MergeCandidateInfo } from "@/hooks/usePhysicsSimulation";
import { MergeSpinner } from "./MergeSpinner";
import dagre from "dagre";
import WordLevelContent from "./WordLevelContent";

type MergeType = "prepend" | "append" | "interleave" | "summarize";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SemanticZoom = "full" | "summary" | "compact" | "dot";

interface Position { x: number; y: number }

interface WorkspaceCanvasProps {
  workspace: Workspace;
  onSplitRange: (fragmentId: string, charStart: number, charEnd: number) => void;
  onMoveFragment: (fragmentId: string, toIndex: number) => void;
  onZoneTransfer: (fragmentId: string, toZone: string) => void;
  onEdit: (fragmentId: string, content: string) => void;
  onGenerate: (parentFragmentId: string) => void;
  onReplace: (fragmentId: string, selectedText: string, fullContent: string) => void;
  onSubmitMessage: (text: string) => void;
  onSelectFragment: (fragmentId: string) => void;
  onRefresh: () => void;
  isGenerating: boolean;
  enableWordLevel?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NODE_WIDTH_FULL = 480;
const NODE_WIDTH_SUMMARY = 320;
const NODE_WIDTH_COMPACT = 200;
const NODE_WIDTH_DOT = 24;
const STAGE_X_OFFSET = 600;

// Zoom thresholds: viewport zoom → semantic level
function getSemanticZoom(viewportZoom: number): SemanticZoom {
  if (viewportZoom >= 0.8) return "full";
  if (viewportZoom >= 0.45) return "summary";
  if (viewportZoom >= 0.2) return "compact";
  return "dot";
}

function getNodeWidth(sz: SemanticZoom): number {
  switch (sz) {
    case "full": return NODE_WIDTH_FULL;
    case "summary": return NODE_WIDTH_SUMMARY;
    case "compact": return NODE_WIDTH_COMPACT;
    case "dot": return NODE_WIDTH_DOT;
  }
}

// ---------------------------------------------------------------------------
// Content rendering helpers
// ---------------------------------------------------------------------------

function getFirstLine(text: string): string {
  const line = text.split(/[.\n]/)[0]?.trim() || text.slice(0, 60);
  return line.length > 80 ? line.slice(0, 77) + "..." : line;
}

function getLastLine(text: string): string {
  const lines = text.trim().split(/[.\n]/).filter(Boolean);
  const line = lines[lines.length - 1]?.trim() || "";
  return line.length > 80 ? line.slice(0, 77) + "..." : line;
}

function getSummary(text: string): string {
  // Middle of the content, compressed
  const sentences = text.split(/[.!?]\s+/).filter(Boolean);
  if (sentences.length <= 2) return "";
  const middle = sentences.slice(1, -1).join(". ");
  return middle.length > 120 ? middle.slice(0, 117) + "..." : middle;
}

// ---------------------------------------------------------------------------
// Provenance colors
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

function provenanceDotColor(f: Fragment): string {
  switch (f.provenance.type) {
    case "ai-generated": return "bg-blue-500";
    case "human-typed": return "bg-emerald-500";
    case "split": case "extracted": return "bg-violet-500";
    case "imported": return "bg-amber-500";
    default: return "bg-stone-500";
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

function edgeLabel(type: Edge["type"]): string {
  switch (type) {
    case "responded-to": return "→";
    case "split-from": return "split";
    case "derived": return "alt";
    case "imported-from": return "ref";
  }
}

// ---------------------------------------------------------------------------
// Dagre layout
// ---------------------------------------------------------------------------

function computeDagreLayout(
  fragments: Fragment[],
  edges: Edge[],
  nodeWidth: number,
  nodeHeight: number,
  direction: "TB" | "LR" = "TB"
): Record<string, Position> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction, nodesep: 40, ranksep: 60, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));

  const fragIds = new Set(fragments.map((f) => f.id));
  for (const f of fragments) {
    g.setNode(f.id, { width: nodeWidth, height: nodeHeight });
  }
  for (const e of edges) {
    if (fragIds.has(e.from) && fragIds.has(e.to)) {
      g.setEdge(e.from, e.to);
    }
  }

  dagre.layout(g);

  const positions: Record<string, Position> = {};
  for (const f of fragments) {
    const node = g.node(f.id);
    if (node) {
      positions[f.id] = { x: node.x - nodeWidth / 2, y: node.y - nodeHeight / 2 };
    }
  }
  return positions;
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
  onReplace,
  onSubmitMessage,
  onSelectFragment,
  onRefresh,
  isGenerating,
  enableWordLevel = false,
}: WorkspaceCanvasProps) {
  const [manualPositions, setManualPositions] = useState<Record<string, Position>>({});
  const [splitToolbar, setSplitToolbar] = useState<{
    fragmentId: string; charStart: number; charEnd: number; x: number; y: number;
  } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [dragState, setDragState] = useState<{
    fragmentId: string; offsetX: number; offsetY: number;
  } | null>(null);
  const [inputText, setInputText] = useState("");

  // Merge candidate state
  const [mergeCandidate, setMergeCandidate] = useState<{
    draggedId: string;
    targetId: string;
    angle: number;
    mergeType: MergeType;
    startedAt: number;
    confirmed: boolean;
  } | null>(null);

  // Velocity tracking for physics injection on drag release
  const lastDragPosRef = useRef<Position | null>(null);
  const lastDragTimeRef = useRef<number>(0);
  const lastVelocityRef = useRef<{ vx: number; vy: number }>({ vx: 0, vy: 0 });

  const viewportRef = useRef<HTMLDivElement>(null);
  const { state: panZoom, containerRef, handlers: panZoomHandlers, fitToBox } = usePanZoom();

  // Auto-fit: runs once when fragments first have positions, then again
  // whenever the workspace id changes (open a different workspace).
  const hasAutoFitForWorkspaceRef = useRef<string | null>(null);

  // Semantic zoom level derived from viewport zoom
  const semanticZoom = getSemanticZoom(panZoom.zoom);
  const nodeWidth = getNodeWidth(semanticZoom);

  // -----------------------------------------------------------------------
  // Derived data
  // -----------------------------------------------------------------------

  const sequenceFragments = useMemo(
    () => ws.sequence.map((id) => ws.fragments[id]).filter((f): f is Fragment => !!f && f.provenance.type !== "system"),
    [ws.sequence, ws.fragments]
  );

  const stageFragments = useMemo(
    () => ws.stageIds.map((id) => ws.fragments[id]).filter((f): f is Fragment => !!f),
    [ws.stageIds, ws.fragments]
  );

  const splitSourceIds = useMemo(
    () => new Set(ws.edges.filter((e) => e.type === "split-from").map((e) => e.from)),
    [ws.edges]
  );

  const unplacedFragments = useMemo(() => {
    const inSeq = new Set(ws.sequence);
    const inStage = new Set(ws.stageIds);
    return Object.values(ws.fragments).filter(
      (f) => !inSeq.has(f.id) && !inStage.has(f.id) &&
        f.status === "complete" && f.content &&
        f.provenance.type !== "system" && !splitSourceIds.has(f.id)
    );
  }, [ws.fragments, ws.sequence, ws.stageIds, splitSourceIds]);

  const generatingFragments = useMemo(
    () => Object.values(ws.fragments).filter((f) => f.status === "generating"),
    [ws.fragments]
  );

  const siblingGroups = useMemo(() => {
    const groups: Record<string, string[]> = {};
    const parentToChildren: Record<string, string[]> = {};
    for (const edge of ws.edges) {
      if (edge.type === "responded-to") {
        if (!parentToChildren[edge.from]) parentToChildren[edge.from] = [];
        parentToChildren[edge.from].push(edge.to);
      }
    }
    for (const children of Object.values(parentToChildren)) {
      if (children.length > 1) {
        for (const childId of children) groups[childId] = children;
      }
    }
    return groups;
  }, [ws.edges]);

  // All visible fragments for layout
  const allVisible = useMemo(
    () => [...sequenceFragments, ...stageFragments, ...unplacedFragments, ...generatingFragments],
    [sequenceFragments, stageFragments, unplacedFragments, generatingFragments]
  );

  // Visible edges
  const visibleEdges = useMemo(() => {
    const ids = new Set(allVisible.map((f) => f.id));
    return ws.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  }, [ws.edges, allVisible]);

  // -----------------------------------------------------------------------
  // Layout: dagre for sequence, offset for stage/unplaced
  // -----------------------------------------------------------------------

  const nodeH = semanticZoom === "dot" ? 24 : semanticZoom === "compact" ? 40 : 80;

  const basePositions = useMemo(() => {
    // Dagre layout for sequence fragments
    const seqEdges = ws.edges.filter((e) => {
      const seqSet = new Set(ws.sequence);
      return seqSet.has(e.from) && seqSet.has(e.to);
    });
    const dagrePos = computeDagreLayout(
      sequenceFragments, seqEdges, nodeWidth, nodeH
    );

    // Stage + unplaced: vertical column to the right
    let stageY = 40;
    const stagePos: Record<string, Position> = {};
    for (const f of [...stageFragments, ...unplacedFragments]) {
      stagePos[f.id] = { x: STAGE_X_OFFSET, y: stageY };
      stageY += nodeH + 20;
    }

    // Generating: below sequence
    let genY = Object.values(dagrePos).reduce((max, p) => Math.max(max, p.y + nodeH), 100) + 40;
    const genPos: Record<string, Position> = {};
    for (const f of generatingFragments) {
      genPos[f.id] = { x: 40, y: genY };
      genY += 60;
    }

    return { ...dagrePos, ...stagePos, ...genPos };
  }, [sequenceFragments, stageFragments, unplacedFragments, generatingFragments,
      ws.edges, ws.sequence, semanticZoom, nodeWidth, nodeH]);

  // -----------------------------------------------------------------------
  // Physics simulation
  // -----------------------------------------------------------------------

  const physicsNodeSize = useCallback((id: string) => ({ w: nodeWidth, h: nodeH }), [nodeWidth, nodeH]);

  const { physicsPositions, physicsPositionsRef, inject, wake, killNode, isAwake, pinRestPosition } = usePhysicsSimulation({
    nodeIds: useMemo(() => allVisible.map((f) => f.id), [allVisible]),
    initialPositions: ws.canvasPositions ?? {},
    dagrePositions: basePositions,
    edges: visibleEdges,
    nodeSize: physicsNodeSize,
    pinnedId: dragState?.fragmentId ?? null,
    pinnedPosition: dragState ? manualPositions[dragState.fragmentId] ?? null : null,
    onStabilize: useCallback((positions: Record<string, Position>) => {
      fetch("/api/tree/canvas-positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ treeId: ws.id, positions }),
      }).catch(() => {}); // fire-and-forget
    }, [ws.id]),
    onMergeCandidate: useCallback((info: MergeCandidateInfo) => {
      setMergeCandidate((prev) => {
        if (prev?.draggedId === info.draggedId && prev?.targetId === info.targetId) return prev;
        return {
          draggedId: info.draggedId,
          targetId: info.targetId,
          angle: info.angle,
          mergeType: angleToMergeType(info.angle),
          startedAt: Date.now(),
          confirmed: false,
        };
      });
    }, []),
    onMergeCancelled: useCallback(() => {
      setMergeCandidate(null);
    }, []),
  });

  // Final positions: physics overrides dagre, manual overrides physics
  const positions = useMemo(() => ({
    ...basePositions,
    ...physicsPositions,
    ...manualPositions,
  }), [basePositions, physicsPositions, manualPositions]);

  // -----------------------------------------------------------------------
  // Bounding box of all visible content (in canvas-content coordinates)
  // -----------------------------------------------------------------------

  const contentBbox = useMemo(() => {
    const ids = allVisible.map((f) => f.id).filter((id) => positions[id]);
    if (ids.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of ids) {
      const p = positions[id];
      if (!p) continue;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + nodeWidth);
      maxY = Math.max(maxY, p.y + nodeH);
    }
    if (!isFinite(minX)) return null;
    return { minX, minY, maxX, maxY };
  }, [allVisible, positions, nodeWidth, nodeH]);

  // -----------------------------------------------------------------------
  // Auto-fit on workspace open
  // -----------------------------------------------------------------------

  const fitNow = useCallback(() => {
    if (!contentBbox || !containerRef.current) return;
    const r = containerRef.current.getBoundingClientRect();
    fitToBox(contentBbox, { width: r.width, height: r.height }, 0.08);
  }, [contentBbox, fitToBox, containerRef]);

  useEffect(() => {
    if (hasAutoFitForWorkspaceRef.current === ws.id) return;
    if (!contentBbox || !containerRef.current) return;
    const r = containerRef.current.getBoundingClientRect();
    if (r.width < 50 || r.height < 50) return; // not laid out yet
    fitToBox(contentBbox, { width: r.width, height: r.height }, 0.08);
    hasAutoFitForWorkspaceRef.current = ws.id;
  }, [ws.id, contentBbox, fitToBox, containerRef]);

  // -----------------------------------------------------------------------
  // Re-layout: clear saved positions and let dagre + physics start fresh
  // -----------------------------------------------------------------------

  const relayoutNow = useCallback(async () => {
    setManualPositions({});
    hasAutoFitForWorkspaceRef.current = null; // re-fit on next stabilize
    try {
      await fetch("/api/tree/canvas-positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ treeId: ws.id, positions: {}, replace: true }),
      });
    } catch {
      /* fire-and-forget; physics will save fresh positions on its next stabilize */
    }
    onRefresh();
  }, [ws.id, onRefresh]);

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  const handleTextMouseUp = useCallback((fragmentId: string, content: string) => {
    if (semanticZoom !== "full") return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) { setSplitToolbar(null); return; }
    const text = sel.toString().trim();
    if (!text || text.length < 2) { setSplitToolbar(null); return; }
    const charStart = content.indexOf(text);
    if (charStart === -1) { setSplitToolbar(null); return; }
    const charEnd = charStart + text.length;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const cr = containerRef.current?.getBoundingClientRect();
    if (!cr) return;
    setSplitToolbar({
      fragmentId, charStart, charEnd,
      x: (rect.left + rect.width / 2 - cr.left - panZoom.panX) / panZoom.zoom,
      y: (rect.top - cr.top - panZoom.panY) / panZoom.zoom - 8,
    });
  }, [semanticZoom, panZoom, containerRef]);

  const handlePointerDown = useCallback((e: React.PointerEvent, fragmentId: string) => {
    if (editingId) return;
    // If the pointer landed on text content, let the browser handle text selection
    const target = e.target as HTMLElement;
    if (target.closest("[data-text-content]")) return;
    e.preventDefault(); e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    setDragState({ fragmentId, offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top });
    el.setPointerCapture(e.pointerId);
  }, [editingId]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState) return;
    e.preventDefault();
    const c = containerRef.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    const newPos: Position = {
      x: (e.clientX - r.left - dragState.offsetX) / panZoom.zoom,
      y: (e.clientY - r.top - dragState.offsetY) / panZoom.zoom,
    };

    // Track velocity for injection on release
    const now = Date.now();
    if (lastDragPosRef.current && lastDragTimeRef.current) {
      const dt = now - lastDragTimeRef.current;
      if (dt > 0) {
        lastVelocityRef.current = {
          vx: (newPos.x - lastDragPosRef.current.x) / dt * 16, // scale to ~frame units
          vy: (newPos.y - lastDragPosRef.current.y) / dt * 16,
        };
      }
    }
    lastDragPosRef.current = newPos;
    lastDragTimeRef.current = now;

    setManualPositions((prev) => ({
      ...prev,
      [dragState.fragmentId]: newPos,
    }));
  }, [dragState, panZoom.zoom, containerRef]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (dragState) {
      // Clear merge candidate if not yet confirmed
      if (mergeCandidate && !mergeCandidate.confirmed) setMergeCandidate(null);

      // Pin the dagre rest target to where the user dropped the node
      const dropPos = manualPositions[dragState.fragmentId];
      if (dropPos) {
        pinRestPosition(dragState.fragmentId, dropPos);
      }

      // Inject drag velocity into physics so node coasts
      const v = lastVelocityRef.current;
      inject(dragState.fragmentId, v.vx, v.vy);

      // Remove manual override — let physics own the position now
      setManualPositions((prev) => {
        const next = { ...prev };
        delete next[dragState.fragmentId];
        return next;
      });

      lastDragPosRef.current = null;
      lastDragTimeRef.current = 0;
      lastVelocityRef.current = { vx: 0, vy: 0 };

      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      setDragState(null);
    }
  }, [dragState, inject, manualPositions, pinRestPosition]);

  const startEdit = useCallback((f: Fragment) => { setEditingId(f.id); setEditText(f.content); }, []);
  const saveEdit = useCallback(() => { if (editingId) { onEdit(editingId, editText); setEditingId(null); } }, [editingId, editText, onEdit]);
  const handleSend = useCallback(() => { if (!inputText.trim()) return; onSubmitMessage(inputText.trim()); setInputText(""); }, [inputText, onSubmitMessage]);


  // Merge candidate timer: confirm after 2 seconds of continuous overlap
  useEffect(() => {
    if (!mergeCandidate || mergeCandidate.confirmed) return;
    const elapsed = Date.now() - mergeCandidate.startedAt;
    const remaining = 2000 - elapsed;
    if (remaining <= 0) {
      setMergeCandidate((prev) => prev ? { ...prev, confirmed: true } : null);
      return;
    }
    const id = setTimeout(() => {
      setMergeCandidate((prev) => prev ? { ...prev, confirmed: true } : null);
    }, remaining);
    return () => clearTimeout(id);
  }, [mergeCandidate]);

  // Fire merge API when confirmed (Phase 7 will add the actual endpoint)
  useEffect(() => {
    if (!mergeCandidate?.confirmed) return;
    const { draggedId, targetId, mergeType } = mergeCandidate;
    fetch("/api/tree/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        treeId: ws.id,
        sourceId: draggedId,
        targetId,
        mergeType,
      }),
    })
      .then(() => {
        killNode(draggedId);
        setMergeCandidate(null);
        onRefresh();
      })
      .catch(() => {
        setMergeCandidate(null);
      });
  }, [mergeCandidate?.confirmed, ws.id, killNode, onRefresh]);

  // -----------------------------------------------------------------------
  // Render fragment based on semantic zoom
  // -----------------------------------------------------------------------

  const renderFragment = useCallback((f: Fragment, zone: "workspace" | "stage" | "unplaced") => {
    const pos = positions[f.id];
    if (!pos) return null;

    const isEditing = editingId === f.id;
    const isInSequence = ws.sequence.includes(f.id);
    const siblings = siblingGroups[f.id];
    const seqIndex = ws.sequence.indexOf(f.id);
    const color = provenanceColor(f);
    const label = provenanceLabel(f);
    const isGen = f.status === "generating";

    // DOT level — just a colored circle
    if (semanticZoom === "dot") {
      return (
        <div
          key={f.id}
          className={`absolute rounded-full ${provenanceDotColor(f)} cursor-pointer transition-all hover:scale-150`}
          style={{ left: pos.x, top: pos.y, width: 20, height: 20, opacity: zone === "unplaced" ? 0.4 : 1 }}
          title={`${label}: ${f.content.slice(0, 80)}`}
          onClick={() => onSelectFragment(f.id)}
        />
      );
    }

    // COMPACT level — single line, big font
    if (semanticZoom === "compact") {
      return (
        <div
          key={f.id}
          className={`absolute rounded-lg border px-2 py-1 transition-all ${color}`}
          style={{ left: pos.x, top: pos.y, width: NODE_WIDTH_COMPACT, opacity: zone === "unplaced" ? 0.4 : 1 }}
          onPointerDown={(e) => handlePointerDown(e, f.id)}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <div className="text-xs font-medium text-stone-200 truncate">
            {getFirstLine(f.content)}
          </div>
          <div className="text-[9px] text-stone-600 mt-0.5">{label}</div>
        </div>
      );
    }

    // SUMMARY level — first line (bright), summary (dim), last line (bright)
    if (semanticZoom === "summary") {
      const first = getFirstLine(f.content);
      const last = getLastLine(f.content);
      const summary = getSummary(f.content);
      return (
        <div
          key={f.id}
          className={`absolute rounded-xl border px-3 py-2 transition-all ${color}`}
          style={{ left: pos.x, top: pos.y, width: NODE_WIDTH_SUMMARY, opacity: zone === "unplaced" ? 0.5 : 1 }}
          onPointerDown={(e) => handlePointerDown(e, f.id)}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <div className="text-[10px] text-stone-500 mb-1">{label} {isInSequence && `#${seqIndex + 1}`}</div>
          <div className="text-sm font-medium text-stone-100 leading-snug">{first}</div>
          {summary && <div className="text-xs text-stone-500 leading-snug mt-1 italic">{summary}</div>}
          {first !== last && <div className="text-sm font-medium text-stone-300 leading-snug mt-1">{last}</div>}
        </div>
      );
    }

    // FULL level — complete text, editable, split toolbar
    return (
      <div
        key={f.id}
        className="absolute cursor-default group"
        style={{
          left: pos.x, top: pos.y, width: NODE_WIDTH_FULL,
          zIndex: dragState?.fragmentId === f.id ? 50 : 1,
          opacity: zone === "unplaced" ? 0.5 : zone === "stage" ? 0.7 : 1,
        }}
        onPointerDown={(e) => handlePointerDown(e, f.id)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={() => startEdit(f)}
      >
        <div className={`rounded-xl border px-4 py-3 text-sm leading-relaxed transition-all ${color} ${isGen ? "animate-pulse" : ""} ${zone === "stage" ? "border-dashed border-amber-800/60" : ""}`}>
          <div className="flex items-center justify-between mb-1 cursor-grab active:cursor-grabbing">
            <span className="text-[10px] uppercase tracking-wider text-stone-500">
              {label}
              {f.timing && <span className="ml-2 text-stone-700">{f.timing.durationMs < 1000 ? `${f.timing.durationMs}ms` : `${(f.timing.durationMs / 1000).toFixed(1)}s`}</span>}
            </span>
            <div className="flex items-center gap-2">
              {siblings && siblings.length > 1 && <span className="text-[10px] text-stone-600">{siblings.indexOf(f.id) + 1}/{siblings.length}</span>}
              {isInSequence && <span className="bg-stone-600 text-stone-200 text-[10px] font-mono rounded-full w-5 h-5 flex items-center justify-center">{seqIndex + 1}</span>}
              {!isInSequence && zone === "unplaced" && (
                <button onClick={(e) => { e.stopPropagation(); onSelectFragment(f.id); }} className="text-[10px] px-1.5 py-0.5 bg-blue-900/50 text-blue-300 rounded hover:bg-blue-800/50">pick</button>
              )}
              {zone !== "stage" && (
                <button onClick={(e) => { e.stopPropagation(); onGenerate(f.id); }} className="text-[10px] px-1 text-blue-600 hover:text-blue-400 opacity-0 group-hover:opacity-100">extend</button>
              )}
              {zone === "workspace" && (
                <button onClick={(e) => { e.stopPropagation(); onZoneTransfer(f.id, "stage"); }} className="text-[10px] px-1 text-stone-600 hover:text-stone-400 opacity-0 group-hover:opacity-100">stage</button>
              )}
              {zone === "stage" && (
                <button onClick={(e) => { e.stopPropagation(); onZoneTransfer(f.id, "workspace"); }} className="text-[10px] px-1 text-amber-600 hover:text-amber-400 opacity-0 group-hover:opacity-100">unstage</button>
              )}
            </div>
          </div>
          {isEditing ? (
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <textarea value={editText} onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") setEditingId(null); if (e.key === "Enter" && e.metaKey) saveEdit(); }}
                onBlur={() => setEditingId(null)}
                className="w-full bg-stone-900 border border-stone-600 rounded px-2 py-1 pr-8 text-sm text-stone-200 focus:outline-none resize-y min-h-[60px]" rows={4} autoFocus />
              <button onMouseDown={(e) => { e.preventDefault(); saveEdit(); }}
                className="absolute top-1.5 right-1.5 text-stone-500 hover:text-emerald-400 text-sm" title="Save (Cmd+Enter)">
                &#x2713;
              </button>
            </div>
          ) : isGen ? (
            <div className="text-stone-500">Generating...</div>
          ) : f.status === "error" ? (
            <div className="text-red-400 text-xs">Error: {f.error || "failed"}</div>
          ) : enableWordLevel ? (
            <WordLevelContent
              content={f.content}
              onContentChange={(newContent) => {
                onEdit(f.id, newContent);
              }}
              containerWidth={NODE_WIDTH_FULL - 32} // Account for padding
            />
          ) : (
            <div data-text-content className="whitespace-pre-wrap select-text text-stone-200 cursor-text" onMouseUp={() => handleTextMouseUp(f.id, f.content)}>
              {f.content}
            </div>
          )}
        </div>
      </div>
    );
  }, [positions, semanticZoom, editingId, editText, dragState, ws.sequence,
      siblingGroups, handlePointerDown, handlePointerMove, handlePointerUp,
      handleTextMouseUp, startEdit, saveEdit, onSelectFragment, onZoneTransfer, enableWordLevel, onEdit]);

  // -----------------------------------------------------------------------
  // Edges with labels
  // -----------------------------------------------------------------------

  const edgeElements = useMemo(() => {
    return visibleEdges.map((edge, i) => {
      const fromPos = positions[edge.from];
      const toPos = positions[edge.to];
      if (!fromPos || !toPos) return null;
      const nodeH = semanticZoom === "dot" ? 20 : semanticZoom === "compact" ? 36 : 80;
      const w = getNodeWidth(semanticZoom);
      const x1 = fromPos.x + w / 2;
      const y1 = fromPos.y + nodeH;
      const x2 = toPos.x + w / 2;
      const y2 = toPos.y;
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const isActive = ws.sequence.includes(edge.from) && ws.sequence.includes(edge.to);
      const lbl = edgeLabel(edge.type);

      return (
        <g key={`edge-${i}`}>
          <line x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={isActive ? "rgba(168, 162, 158, 0.4)" : "rgba(168, 162, 158, 0.15)"}
            strokeWidth={isActive ? 2 : 1}
            strokeDasharray={isActive ? "none" : "4 4"}
            markerEnd={semanticZoom !== "dot" ? "url(#arrowhead)" : undefined}
          />
          {semanticZoom !== "dot" && (
            <text x={mx} y={my - 6} textAnchor="middle" fill="rgba(168, 162, 158, 0.5)" fontSize="10">
              {lbl}
            </text>
          )}
        </g>
      );
    });
  }, [visibleEdges, positions, ws.sequence, semanticZoom]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div ref={viewportRef} className="w-full h-full relative overflow-hidden bg-stone-950">
      {/* Zoom indicator */}
      <div className="absolute top-3 left-3 z-40">
        <span className="text-[10px] text-stone-600">
          zoom: {semanticZoom} ({(panZoom.zoom * 100).toFixed(0)}%)
        </span>
      </div>

      {/* Toolbar: fit + re-layout, then stats */}
      <div className="absolute top-3 right-3 z-40 flex flex-col items-end gap-1">
        <div className="flex gap-1">
          <button
            onClick={fitNow}
            className="text-[10px] px-2 py-0.5 rounded border border-stone-700 text-stone-500 hover:text-stone-300 hover:border-stone-500 transition-colors"
            title="Center and zoom-fit all content (F)"
          >
            fit
          </button>
          <button
            onClick={relayoutNow}
            className="text-[10px] px-2 py-0.5 rounded border border-stone-700 text-stone-500 hover:text-amber-300 hover:border-amber-700 transition-colors"
            title="Discard saved positions and re-run layout from scratch"
          >
            re-layout
          </button>
        </div>
        <div className="text-[10px] text-stone-700">
          {sequenceFragments.length} workspace · {stageFragments.length} staged · {unplacedFragments.length} unplaced · {generatingFragments.length} gen
        </div>
      </div>

      {/* Pan/zoom canvas */}
      <div ref={containerRef} className="w-full h-full"
        style={{ cursor: "default" }}
        {...panZoomHandlers}>
        <div style={{
          transform: `translate(${panZoom.panX}px, ${panZoom.panY}px) scale(${panZoom.zoom})`,
          transformOrigin: "0 0",
        }}>
          {/* SVG edges */}
          <svg className="absolute top-0 left-0 pointer-events-none" style={{ overflow: "visible", width: 1, height: 1 }}>
            <defs>
              <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="rgba(168, 162, 158, 0.4)" />
              </marker>
            </defs>
            {edgeElements}
          </svg>

          {/* Split toolbar */}
          {splitToolbar && semanticZoom === "full" && (
            <div className="absolute z-50 flex gap-1 bg-stone-800 border border-stone-600 rounded-lg shadow-xl px-1.5 py-1 -translate-x-1/2 -translate-y-full pointer-events-auto"
              style={{ left: splitToolbar.x, top: splitToolbar.y }}>
              <button onMouseDown={(e) => {
                e.preventDefault();
                const frag = ws.fragments[splitToolbar.fragmentId];
                if (frag) {
                  const selectedText = frag.content.slice(splitToolbar.charStart, splitToolbar.charEnd);
                  onReplace(splitToolbar.fragmentId, selectedText, frag.content);
                }
                setSplitToolbar(null); window.getSelection()?.removeAllRanges(); onRefresh();
              }}
                className="text-xs px-2 py-0.5 text-violet-300 hover:bg-violet-900/50 rounded">replace</button>
              <button onMouseDown={(e) => { e.preventDefault(); onSplitRange(splitToolbar.fragmentId, splitToolbar.charStart, splitToolbar.charEnd); setSplitToolbar(null); window.getSelection()?.removeAllRanges(); onRefresh(); }}
                className="text-xs px-2 py-0.5 text-stone-300 hover:bg-stone-700 rounded">split</button>
            </div>
          )}

          {/* Stage zone indicator */}
          {(stageFragments.length > 0 || unplacedFragments.length > 0) && (
            <div
              className="absolute border border-dashed border-amber-900/30 rounded-2xl pointer-events-none"
              style={{
                left: STAGE_X_OFFSET - 20,
                top: 10,
                width: nodeWidth + 40,
                height: (stageFragments.length + unplacedFragments.length) * (nodeH + 20) + 40,
                minHeight: 80,
              }}
            >
              <span className="absolute -top-2.5 left-4 bg-stone-950 px-2 text-[10px] uppercase tracking-wider text-amber-800/60">
                stage
              </span>
            </div>
          )}

          {/* Fragments */}
          {allVisible.map((f) => {
            const zone = ws.sequence.includes(f.id) ? "workspace" as const
              : ws.stageIds.includes(f.id) ? "stage" as const
              : "unplaced" as const;
            return renderFragment(f, zone);
          })}

          {/* Merge spinner overlay */}
          {mergeCandidate && positions[mergeCandidate.targetId] && (
            <MergeSpinner
              x={positions[mergeCandidate.targetId].x}
              y={positions[mergeCandidate.targetId].y}
              nodeWidth={nodeWidth}
              nodeHeight={nodeH}
              startedAt={mergeCandidate.startedAt}
              durationMs={2000}
              mergeType={mergeCandidate.mergeType}
              confirmed={mergeCandidate.confirmed}
            />
          )}
        </div>
      </div>

    </div>
  );
}
