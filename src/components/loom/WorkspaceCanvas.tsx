"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type { Workspace, Fragment, Edge } from "@/lib/workspace";
import { usePanZoom } from "@/hooks/usePanZoom";
import { usePhysicsSimulation, angleToMergeType } from "@/hooks/usePhysicsSimulation";
import type { MergeCandidateInfo } from "@/hooks/usePhysicsSimulation";
import { MergeSpinner, MERGE_COLORS_RGB } from "./MergeSpinner";
import InlineAlternativesPanel from "./InlineAlternativesPanel";
import MergePreview from "./MergePreview";
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
  onGenerate: (parentFragmentId: string) => Promise<{ alternatives: string[] } | null> | void;
  onCommitExtend?: (parentFragmentId: string, content: string) => Promise<void> | void;
  onUnmerge?: (mergedFragmentId: string) => Promise<void> | void;
  onReplace: (
    fragmentId: string,
    selectedText: string,
    fullContent: string
  ) => Promise<{ alternatives: string[] } | null> | void;
  onCommitPhraseEdit?: (fragmentId: string, newContent: string) => Promise<void> | void;
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
const MERGE_HOLD_MS = 2000;
const MERGE_LLM_ETA_MS = 9000; // empirical typical wall time for /api/tree/merge

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

// Inline progress for fragments in `generating` status. Merged
// fragments get a live countdown ("merging… 2.1s · ~9s") since the
// LLM merge can take 5–15s and the writer wants to know the wait.
// Other generating fragments fall back to the original italic
// "generating…" placeholder.
function MergeOrGenerateProgress({ fragment }: { fragment: Fragment }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 200);
    return () => clearInterval(id);
  }, []);
  const isMerge = fragment.provenance.type === "merged";
  const startedAtIso = fragment.timing?.startedAt;
  const startedAt = startedAtIso ? new Date(startedAtIso).getTime() : null;
  const elapsed = startedAt ? (Date.now() - startedAt) / 1000 : null;
  const eta = isMerge ? 9 : 12;
  if (!isMerge) return <div className="text-stone-500 italic">generating…</div>;
  return (
    <div className="flex items-center gap-2 text-stone-400 italic">
      <span className="inline-block w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
      <span>merging…</span>
      {elapsed !== null && (
        <span className="text-[11px] tabular-nums text-stone-500">
          {elapsed.toFixed(1)}s · ~{eta}s
        </span>
      )}
    </div>
  );
}

// Tiny floating badge for the inline phrase reroll. Pending: spinner +
// elapsed counter + ETA. Preview: index of N + arrow hints. Anchored
// above the source fragment so it doesn't displace text.
function InlineRerollBadge({
  state,
  startedAt,
  currentIdx,
  total,
}: {
  state: "pending" | "preview" | "committing";
  startedAt: number;
  currentIdx: number;
  total: number;
}) {
  const [, force] = useState(0);
  useEffect(() => {
    if (state !== "pending") return;
    const id = setInterval(() => force((n) => n + 1), 100);
    return () => clearInterval(id);
  }, [state]);

  if (state === "pending") {
    const elapsed = (Date.now() - startedAt) / 1000;
    const eta = 12;
    return (
      <div className="absolute -top-7 left-2 z-50 flex items-center gap-1.5 px-2 py-0.5 rounded bg-violet-950/80 border border-violet-700/60 text-[10px] text-violet-200 font-mono pointer-events-none">
        <span className="inline-block w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
        <span className="tabular-nums">{elapsed.toFixed(1)}s · ~{eta}s</span>
      </div>
    );
  }
  if (state === "committing") {
    return (
      <div className="absolute -top-7 left-2 z-50 px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-700/60 text-[10px] text-emerald-200 font-mono pointer-events-none">
        committing…
      </div>
    );
  }
  // preview
  return (
    <div className="absolute -top-7 left-2 z-50 flex items-center gap-1.5 px-2 py-0.5 rounded bg-violet-950/80 border border-violet-600/70 text-[10px] text-violet-100 font-mono pointer-events-auto">
      <span className="text-violet-300">←</span>
      <span className="tabular-nums">{currentIdx + 1}/{total}</span>
      <span className="text-violet-300">→</span>
      <span className="text-violet-500/80 ml-1">↵ pick · esc revert</span>
    </div>
  );
}

// Estimate the rendered height of a fragment so dagre + physics give it
// enough vertical room. Without this, every fragment is treated as 80px
// tall and 10-line AI completions overlap their neighbors. The estimator
// is content-length driven — cheaper than DOM measurement and good enough
// for layout (real heights settle in once physics has run a frame or two).
function estimateFragmentHeight(content: string, sz: SemanticZoom): number {
  if (sz === "dot") return 24;
  if (sz === "compact") return 44;
  if (sz === "summary") return 96;
  // FULL: ~60 chars per line at NODE_WIDTH_FULL, 23px line-height, +40 chrome
  const len = content?.length ?? 0;
  const lines = Math.max(2, Math.ceil(len / 60));
  return Math.min(640, lines * 23 + 40);
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

// Bare left-edge stripe — the only persistent provenance cue when the
// fragment is at rest. Two pixels of color, the rest of the surface stays
// transparent so the text can "float" on the canvas. Hover state (handled
// elsewhere) adds back the toolbar and any background tint.
function provenanceStripe(f: Fragment): string {
  switch (f.provenance.type) {
    case "ai-generated": return "border-l-2 border-l-blue-500/60";
    case "human-typed": return "border-l-2 border-l-emerald-500/70";
    case "split": case "extracted": return "border-l-2 border-l-violet-500/60";
    case "imported": return "border-l-2 border-l-amber-500/60";
    case "derived": return "border-l-2 border-l-teal-500/60";
    case "system": return "border-l-2 border-l-stone-500/40";
    default: return "border-l-2 border-l-stone-500/40";
  }
}

// Per-model warmth tinting on top of provenanceStripe — subtle so it doesn't
// shout, but distinct enough to read at a glance which model wrote what.
// Only applied when provenance.type === "ai-generated".
function modelTextColor(f: Fragment): string {
  if (f.provenance.type !== "ai-generated") return "text-stone-200";
  const model = (f.provenance.model || "").toLowerCase();
  if (model.includes("sonnet") || model.includes("opus")) return "text-amber-50/95";
  if (model.includes("haiku")) return "text-cyan-50/95";
  if (model.includes("gemini") || model.includes("flash")) return "text-emerald-50/95";
  if (model.includes("llama")) return "text-violet-50/95";
  return "text-stone-200";
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
  heightFor: (f: Fragment) => number,
  direction: "TB" | "LR" = "TB"
): Record<string, Position> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction, nodesep: 60, ranksep: 80, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));

  const fragIds = new Set(fragments.map((f) => f.id));
  const heightCache: Record<string, number> = {};
  for (const f of fragments) {
    const h = heightFor(f);
    heightCache[f.id] = h;
    g.setNode(f.id, { width: nodeWidth, height: h });
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
    const h = heightCache[f.id];
    if (node) {
      positions[f.id] = { x: node.x - nodeWidth / 2, y: node.y - h / 2 };
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
  onCommitPhraseEdit,
  onCommitExtend,
  onUnmerge,
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

  // Inline alternatives state — used by both "replace" (in-place phrase
  // swap) and "extend" (in-place continuation preview). Shared shape for
  // shared keyboard / badge logic; mode field discriminates the rendering
  // and the commit action.
  //
  // replace: user selects text + clicks replace. Source fragment renders
  //   with prefix + highlighted-alternative + suffix. Commit edits the
  //   source fragment's content in place; no new nodes.
  // extend: user clicks extend on hover toolbar. Source fragment renders
  //   normally; a ghost continuation is appended after it. Commit appends
  //   exactly ONE new child fragment with the chosen content; the other
  //   alternatives never persist.
  type InlineAltsState =
    | {
        mode: "replace";
        sourceFragmentId: string;
        selectedText: string;
        charStart: number;
        charEnd: number;
        state: "pending" | "preview" | "committing";
        alternatives: string[];
        currentIdx: number;
        startedAt: number;
      }
    | {
        mode: "extend";
        sourceFragmentId: string;
        state: "pending" | "preview" | "committing";
        alternatives: string[];
        currentIdx: number;
        startedAt: number;
      };
  const [inlineAlts, setInlineAlts] = useState<InlineAltsState | null>(null);

  // Keyboard shortcuts during an inline-alternatives preview (replace OR
  // extend). Arrows cycle, Enter commits per-mode, Esc dismisses.
  useEffect(() => {
    if (!inlineAlts || inlineAlts.state !== "preview") return;
    const handler = (e: KeyboardEvent) => {
      const N = inlineAlts.alternatives.length;
      if (N === 0) return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
        e.preventDefault();
        setInlineAlts((prev) => prev ? { ...prev, currentIdx: (prev.currentIdx + 1) % N } : prev);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
        e.preventDefault();
        setInlineAlts((prev) => prev ? { ...prev, currentIdx: (prev.currentIdx - 1 + N) % N } : prev);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const ia = inlineAlts;
        const alt = ia.alternatives[ia.currentIdx];
        if (!alt) return;
        if (ia.mode === "replace") {
          const frag = ws.fragments[ia.sourceFragmentId];
          if (!frag || !onCommitPhraseEdit) return;
          const newContent = frag.content.slice(0, ia.charStart) + alt + frag.content.slice(ia.charEnd);
          setInlineAlts((prev) => prev ? { ...prev, state: "committing" } : prev);
          Promise.resolve(onCommitPhraseEdit(ia.sourceFragmentId, newContent)).finally(() => {
            setInlineAlts(null);
          });
        } else {
          // extend mode — append a new child fragment under the source
          if (!onCommitExtend) return;
          setInlineAlts((prev) => prev ? { ...prev, state: "committing" } : prev);
          Promise.resolve(onCommitExtend(ia.sourceFragmentId, alt)).finally(() => {
            setInlineAlts(null);
          });
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        setInlineAlts(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [inlineAlts, onCommitPhraseEdit, onCommitExtend, ws.fragments]);

  // Velocity tracking for physics injection on drag release
  const lastDragPosRef = useRef<Position | null>(null);
  const lastDragTimeRef = useRef<number>(0);
  const lastVelocityRef = useRef<{ vx: number; vy: number }>({ vx: 0, vy: 0 });

  const viewportRef = useRef<HTMLDivElement>(null);
  const { state: panZoom, containerRef, handlers: panZoomHandlers, fitToBox } = usePanZoom();

  // Auto-fit: runs once when fragments first have positions, then again
  // whenever the workspace id changes (open a different workspace).
  const hasAutoFitForWorkspaceRef = useRef<string | null>(null);

  // Semantic zoom level derived from viewport zoom (used for visual
  // rendering only — layout/physics use canonical FULL-level dimensions
  // declared further down).
  const semanticZoom = getSemanticZoom(panZoom.zoom);

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

  // All visible fragments for layout. Per the phase-transition vision,
  // canvas shows ONE traversal of the tree — sequence + stage + active
  // generations. Sibling alternatives (unplacedFragments) are hidden here;
  // they live in tree view and surface ephemerally during inline reroll.
  //
  // CRITICAL: dedupe by fragment id. A merged fragment lands in both
  // sequence (just-inserted) and generatingFragments (status=generating
  // while Claude runs), so concatenating without dedupe causes React
  // duplicate-key errors and double-rendering during the merge LLM
  // window.
  const allVisible = useMemo(() => {
    const seen = new Map<string, Fragment>();
    for (const f of sequenceFragments) seen.set(f.id, f);
    for (const f of stageFragments) seen.set(f.id, f);
    for (const f of generatingFragments) seen.set(f.id, f);
    return Array.from(seen.values());
  }, [sequenceFragments, stageFragments, generatingFragments]);

  // Visible edges
  const visibleEdges = useMemo(() => {
    const ids = new Set(allVisible.map((f) => f.id));
    return ws.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  }, [ws.edges, allVisible]);

  // -----------------------------------------------------------------------
  // Layout: dagre for sequence, offset for stage/unplaced
  // -----------------------------------------------------------------------

  // Layout/physics always work in canonical FULL-level coordinate space,
  // regardless of the current viewport zoom. This decouples physics from
  // semantic-zoom transitions — crossing a zoom threshold (compact→summary
  // at 45%, summary→full at 80%) used to change nodeWidth/heightFor and
  // yank every fragment toward new dagre targets, which in turn made the
  // bbox-overlap force violently rebalance. With layout in canonical
  // space, semantic zoom is purely a visual operation — pan/zoom CSS
  // transform handles the apparent shrink, no physics is triggered.
  //
  // The visualNodeWidth / visualNodeH below are used only for rendering
  // (card width at compact/summary/dot levels, edge geometry).
  const nodeWidth = NODE_WIDTH_FULL;
  const nodeH = 96;
  const visualNodeWidth = getNodeWidth(semanticZoom);
  const visualNodeH = semanticZoom === "dot" ? 24 : semanticZoom === "compact" ? 44 : 96;

  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>({});
  const heightFor = useCallback(
    (f: Fragment) => {
      const measured = measuredHeights[f.id];
      if (measured && measured > 12) return measured;
      // Always estimate at FULL level so layout doesn't shrink/grow
      // when the writer changes zoom.
      return estimateFragmentHeight(f.content, "full");
    },
    [measuredHeights]
  );

  // ResizeObserver: every rendered fragment reports its actual height.
  // We index by data-fragment-id (set on each fragment's outer div).
  // Updates are coalesced and only trigger a state change when the
  // measured height drifts by >4px from the last recorded value, to
  // avoid feedback loops with the layout engines.
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      setMeasuredHeights((prev) => {
        let next: Record<string, number> | null = null;
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          const id = el.dataset.fragmentId;
          if (!id) continue;
          const h = entry.contentRect.height;
          if (h < 12) continue;
          if (Math.abs((prev[id] ?? 0) - h) > 4) {
            if (!next) next = { ...prev };
            next[id] = h;
          }
        }
        return next ?? prev;
      });
    });
    const observed = new Set<Element>();
    const tick = () => {
      const els = document.querySelectorAll<HTMLElement>("[data-fragment-id]");
      els.forEach((el) => {
        if (!observed.has(el)) {
          ro.observe(el);
          observed.add(el);
        }
      });
    };
    tick();
    // re-scan after each render commit (new fragments might have appeared)
    const interval = setInterval(tick, 500);
    return () => {
      clearInterval(interval);
      ro.disconnect();
    };
  }, []);

  const basePositions = useMemo(() => {
    // Dagre layout for sequence fragments — per-fragment heights so tall
    // completions get the vertical room they need.
    const seqEdges = ws.edges.filter((e) => {
      const seqSet = new Set(ws.sequence);
      return seqSet.has(e.from) && seqSet.has(e.to);
    });
    const dagrePos = computeDagreLayout(sequenceFragments, seqEdges, nodeWidth, heightFor);

    // Stage: vertical column to the right, each fragment getting its own
    // estimated height + breathing room. Unplaced (sibling alternatives)
    // are no longer rendered on canvas, so the stage column stays sparse.
    let stageY = 40;
    const stagePos: Record<string, Position> = {};
    for (const f of stageFragments) {
      const h = heightFor(f);
      stagePos[f.id] = { x: STAGE_X_OFFSET, y: stageY };
      stageY += h + 20;
    }

    // Generating: below sequence
    let genY = Object.values(dagrePos).reduce((max, p) => Math.max(max, p.y + nodeH), 100) + 40;
    const genPos: Record<string, Position> = {};
    for (const f of generatingFragments) {
      genPos[f.id] = { x: 40, y: genY };
      genY += 60;
    }

    return { ...dagrePos, ...stagePos, ...genPos };
  }, [sequenceFragments, stageFragments, generatingFragments,
      ws.edges, ws.sequence, nodeWidth, nodeH, heightFor]);

  // -----------------------------------------------------------------------
  // Physics simulation
  // -----------------------------------------------------------------------

  const physicsNodeSize = useCallback(
    (id: string) => {
      const f = ws.fragments[id];
      return { w: nodeWidth, h: f ? heightFor(f) : nodeH };
    },
    [nodeWidth, nodeH, ws.fragments, heightFor]
  );

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

  // Final positions: physics overrides dagre, manual overrides physics.
  // Once the merge has confirmed and the user has released the mouse,
  // glide the source fragment to the target's position so they visually
  // fuse together during the LLM merging window. CSS transition on
  // left/top (in renderFragment) animates the snap smoothly.
  const positions = useMemo(() => {
    const final: Record<string, Position> = {
      ...basePositions,
      ...physicsPositions,
      ...manualPositions,
    };
    if (mergeCandidate?.confirmed && !dragState) {
      const tp = final[mergeCandidate.targetId];
      if (tp) final[mergeCandidate.draggedId] = tp;
    }
    return final;
  }, [basePositions, physicsPositions, manualPositions, mergeCandidate, dragState]);

  // -----------------------------------------------------------------------
  // Proximity pairs (Experiment B): pairs of visible fragments within r_flow.
  // Visual gradient cue showing two fragments "want to flow together" — the
  // first phase transition before the merge gesture fires. Pure render
  // signal; no physics or layout change here. Continuous-feeling proximity
  // is what the vision asked for over discrete snap.
  // -----------------------------------------------------------------------

  const R_FLOW = 280;   // canvas-coord distance below which a pair is "in flow"
  const R_MERGE = 90;   // canvas-coord distance below which the merge gesture
                        // is essentially primed (handled separately by physics
                        // collision-merge; this is just a visual threshold).

  const proximityPairs = useMemo(() => {
    const ids = allVisible.map((f) => f.id);
    const pairs: { a: string; b: string; dist: number; intensity: number }[] = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = positions[ids[i]];
        const b = positions[ids[j]];
        if (!a || !b) continue;
        // Distance between fragment centers (use width/2, h/2 for centering)
        const fA = ws.fragments[ids[i]];
        const fB = ws.fragments[ids[j]];
        if (!fA || !fB) continue;
        const cx_a = a.x + nodeWidth / 2;
        const cy_a = a.y + heightFor(fA) / 2;
        const cx_b = b.x + nodeWidth / 2;
        const cy_b = b.y + heightFor(fB) / 2;
        const dx = cx_a - cx_b;
        const dy = cy_a - cy_b;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < R_FLOW) {
          // intensity: 0 at r_flow boundary, 1 at r_merge or closer
          const intensity = Math.min(1, Math.max(0, (R_FLOW - dist) / (R_FLOW - R_MERGE)));
          pairs.push({ a: ids[i], b: ids[j], dist, intensity });
        }
      }
    }
    return pairs;
  }, [allVisible, positions, nodeWidth, heightFor, ws.fragments]);

  // -----------------------------------------------------------------------
  // Bounding box of all visible content (in canvas-content coordinates)
  // -----------------------------------------------------------------------

  const contentBbox = useMemo(() => {
    const visible = allVisible.filter((f) => positions[f.id]);
    if (visible.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const f of visible) {
      const p = positions[f.id];
      if (!p) continue;
      const h = heightFor(f);
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + nodeWidth);
      maxY = Math.max(maxY, p.y + h);
    }
    if (!isFinite(minX)) return null;
    // Pad the bbox itself by a quarter-fragment-width so fragments don't
    // sit flush against the viewport padding line — gives the layout
    // breathing room, especially for single-fragment workspaces.
    const inflate = nodeWidth / 4;
    return {
      minX: minX - inflate,
      minY: minY - inflate,
      maxX: maxX + inflate,
      maxY: maxY + inflate,
    };
  }, [allVisible, positions, nodeWidth, heightFor]);

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


  // Merge candidate timer: confirm after 4 seconds of continuous overlap.
  // 2s was too quick — accidental drag-throughs were triggering merges
  // before the writer signalled intent. 4s gives a deliberate pause
  // matching the visual deformation timing.
  useEffect(() => {
    if (!mergeCandidate || mergeCandidate.confirmed) return;
    const elapsed = Date.now() - mergeCandidate.startedAt;
    const remaining = MERGE_HOLD_MS - elapsed;
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
          data-fragment-id={f.id}
          className={`absolute rounded-full ${provenanceDotColor(f)} cursor-pointer transition-all hover:scale-150`}
          style={{ left: pos.x, top: pos.y, width: 20, height: 20, opacity: zone === "unplaced" ? 0.4 : 1 }}
          title={`${label}: ${f.content.slice(0, 80)}`}
          onClick={() => onSelectFragment(f.id)}
        />
      );
    }

    // COMPACT level — single line, provenance stripe only
    if (semanticZoom === "compact") {
      return (
        <div
          key={f.id}
          data-fragment-id={f.id}
          className={`absolute pl-2 pr-1 py-1 cursor-move transition-colors ${provenanceStripe(f)} group hover:bg-stone-900/30 rounded-r`}
          style={{ left: pos.x, top: pos.y, width: NODE_WIDTH_COMPACT, opacity: zone === "unplaced" ? 0.4 : 1 }}
          onPointerDown={(e) => handlePointerDown(e, f.id)}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <div aria-hidden className="absolute -inset-[10px] rounded-md hover:outline hover:outline-1 hover:outline-stone-600/40" style={{ zIndex: -1 }} />
          <div className={`text-xs font-medium truncate ${modelTextColor(f)}`}>
            {getFirstLine(f.content)}
          </div>
          <div className="text-[9px] text-stone-600 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">{label}</div>
        </div>
      );
    }

    // SUMMARY level — provenance stripe + first/middle/last line preview
    if (semanticZoom === "summary") {
      const first = getFirstLine(f.content);
      const last = getLastLine(f.content);
      const summary = getSummary(f.content);
      return (
        <div
          key={f.id}
          data-fragment-id={f.id}
          className={`absolute pl-3 pr-2 py-2 cursor-move transition-colors ${provenanceStripe(f)} group hover:bg-stone-900/30 rounded-r`}
          style={{ left: pos.x, top: pos.y, width: NODE_WIDTH_SUMMARY, opacity: zone === "unplaced" ? 0.5 : 1 }}
          onPointerDown={(e) => handlePointerDown(e, f.id)}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <div aria-hidden className="absolute -inset-[12px] rounded-md hover:outline hover:outline-1 hover:outline-stone-600/40" style={{ zIndex: -1 }} />
          <div className="text-[10px] text-stone-500 mb-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {label} {isInSequence && `·${seqIndex + 1}`}
          </div>
          <div className={`text-sm font-medium leading-snug ${modelTextColor(f)}`}>{first}</div>
          {summary && <div className="text-xs text-stone-500 leading-snug mt-1 italic">{summary}</div>}
          {first !== last && <div className={`text-sm leading-snug mt-1 ${modelTextColor(f)}`}>{last}</div>}
        </div>
      );
    }

    // FULL level — bare text on canvas, chrome only on hover
    const stripe = provenanceStripe(f);
    const textColor = modelTextColor(f);
    const isStaged = zone === "stage";

    // Merge-candidate fade: when this fragment is part of an active
    // merge, fade it out so the merged-preview overlay can dominate.
    // Confirmed → fully invisible (the API write replaces content
    // immediately); held but not confirmed → fades over ~1.6s to track
    // the 2s hold timer.
    const isMergePart = !!mergeCandidate &&
      (mergeCandidate.draggedId === f.id || mergeCandidate.targetId === f.id);
    const baseOpacity = zone === "unplaced" ? 0.45 : isStaged ? 0.7 : 1;
    const mergeFadeOpacity = isMergePart
      ? (mergeCandidate.confirmed ? 0 : 0.15)
      : 1;

    return (
      <div
        key={f.id}
        data-fragment-id={f.id}
        className={`absolute cursor-move group ${stripe} ${isStaged ? "border-l-amber-600/40 border-dashed" : ""}`}
        style={{
          left: pos.x, top: pos.y, width: NODE_WIDTH_FULL,
          zIndex: dragState?.fragmentId === f.id ? 50 : 1,
          opacity: baseOpacity * mergeFadeOpacity,
          transition: isMergePart
            ? "opacity 1.6s ease-out, left 0.6s cubic-bezier(0.4, 0, 0.2, 1), top 0.6s cubic-bezier(0.4, 0, 0.2, 1)"
            : "opacity 250ms ease-out",
        }}
        onPointerDown={(e) => handlePointerDown(e, f.id)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={() => startEdit(f)}
      >
        {/* Grab halo: an invisible 14px-wide ring around the fragment that
            extends the click target so the writer can grab the fragment
            from a generous margin without aiming pixel-perfectly at the
            text-vs-padding boundary. On hover it shows a faint outline so
            the affordance is visible. The halo is a child of the
            fragment outer div, so pointer events on it bubble to the
            outer's onPointerDown handler. */}
        <div
          aria-hidden
          className="absolute -inset-[14px] rounded-md transition-colors hover:outline hover:outline-1 hover:outline-stone-600/40"
          style={{ zIndex: -1 }}
        />
        {/* Inline-phrase-reroll badge — only when this fragment is the
            active source for an in-place phrase preview. Shows the live
            countdown during pending and the index/cycle hint during
            preview. Tiny, anchored above the chrome row. */}
        {inlineAlts && inlineAlts.sourceFragmentId === f.id && (
          <InlineRerollBadge
            state={inlineAlts.state}
            startedAt={inlineAlts.startedAt}
            currentIdx={inlineAlts.currentIdx}
            total={inlineAlts.alternatives.length}
          />
        )}

        {/* Hover toolbar: chrome lives here, hidden until hover. Positioned
            above the text so it doesn't displace the layout. */}
        <div className="absolute -top-6 left-2 right-2 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          <span className="text-[10px] uppercase tracking-wider text-stone-500 pointer-events-none">
            {label}
            {f.timing && <span className="ml-2 text-stone-700">{f.timing.durationMs < 1000 ? `${f.timing.durationMs}ms` : `${(f.timing.durationMs / 1000).toFixed(1)}s`}</span>}
          </span>
          <div className="flex items-center gap-1.5 pointer-events-auto">
            {siblings && siblings.length > 1 && (
              <span className="text-[10px] text-stone-600">{siblings.indexOf(f.id) + 1}/{siblings.length}</span>
            )}
            {isInSequence && (
              <span className="text-[10px] font-mono text-stone-600">·{seqIndex + 1}</span>
            )}
            {!isInSequence && zone === "unplaced" && (
              <button onClick={(e) => { e.stopPropagation(); onSelectFragment(f.id); }} className="text-[10px] px-1.5 py-0.5 text-blue-300 hover:text-blue-100">pick</button>
            )}
            {zone !== "stage" && (
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  const sourceId = f.id;
                  setInlineAlts({
                    mode: "extend",
                    sourceFragmentId: sourceId,
                    state: "pending",
                    alternatives: [],
                    currentIdx: 0,
                    startedAt: Date.now(),
                  });
                  const result = await onGenerate(sourceId);
                  if (result && result.alternatives.length > 0) {
                    setInlineAlts((prev) => prev && prev.mode === "extend" && prev.sourceFragmentId === sourceId
                      ? { ...prev, state: "preview", alternatives: result.alternatives, currentIdx: 0 }
                      : prev);
                  } else {
                    setInlineAlts(null);
                  }
                }}
                className="text-[10px] px-1 text-blue-600 hover:text-blue-400"
              >
                extend
              </button>
            )}
            {zone === "workspace" && (
              <button onClick={(e) => { e.stopPropagation(); onZoneTransfer(f.id, "stage"); }} className="text-[10px] px-1 text-stone-600 hover:text-stone-400">stage</button>
            )}
            {zone === "stage" && (
              <button onClick={(e) => { e.stopPropagation(); onZoneTransfer(f.id, "workspace"); }} className="text-[10px] px-1 text-amber-600 hover:text-amber-400">unstage</button>
            )}
            {f.provenance.type === "merged" && onUnmerge && (
              <button
                onClick={(e) => { e.stopPropagation(); onUnmerge(f.id); }}
                className="text-[10px] px-1 text-rose-500 hover:text-rose-300"
                title="Restore the two original fragments and remove this merged result"
              >
                ↶ unmerge
              </button>
            )}
          </div>
        </div>

        <div
          className={`pl-3 pr-3 py-2 text-[15px] leading-[1.55] transition-colors ${textColor} ${isGen ? "animate-pulse" : ""} group-hover:bg-stone-900/30 rounded-r`}
        >
          {isEditing ? (
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <textarea value={editText} onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") setEditingId(null); if (e.key === "Enter" && e.metaKey) saveEdit(); }}
                onBlur={() => setEditingId(null)}
                className="w-full bg-stone-900 border border-stone-600 rounded px-2 py-1 pr-8 text-[15px] text-stone-200 focus:outline-none resize-y min-h-[60px]" rows={4} autoFocus />
              <button onMouseDown={(e) => { e.preventDefault(); saveEdit(); }}
                className="absolute top-1.5 right-1.5 text-stone-500 hover:text-emerald-400 text-sm" title="Save (Cmd+Enter)">
                &#x2713;
              </button>
            </div>
          ) : isGen ? (
            <MergeOrGenerateProgress fragment={f} />
          ) : f.status === "error" ? (
            <div className="text-red-400 text-xs">Error: {f.error || "failed"}</div>
          ) : enableWordLevel ? (
            <WordLevelContent
              content={f.content}
              onContentChange={(newContent) => {
                onEdit(f.id, newContent);
              }}
              containerWidth={NODE_WIDTH_FULL - 24}
            />
          ) : inlineAlts && inlineAlts.sourceFragmentId === f.id ? (
            // Inline alternatives preview. Two modes:
            //   replace: split content into prefix + highlighted alt + suffix
            //   extend: render content normally + ghost continuation appended
            (() => {
              const ia = inlineAlts;
              const isPending = ia.state === "pending";
              const isCommitting = ia.state === "committing";

              if (ia.mode === "replace") {
                const before = f.content.slice(0, ia.charStart);
                const after = f.content.slice(ia.charEnd);
                const replacement = isPending
                  ? ia.selectedText
                  : ia.alternatives[ia.currentIdx] ?? ia.selectedText;
                return (
                  <div
                    data-text-content
                    className="whitespace-pre-wrap cursor-text"
                    style={{ textWrap: "pretty" } as React.CSSProperties}
                  >
                    {before}
                    <span
                      className={
                        isPending
                          ? "rounded px-0.5 bg-violet-500/15 text-violet-200/80 animate-pulse"
                          : isCommitting
                          ? "rounded px-0.5 bg-emerald-500/30 text-emerald-100"
                          : "rounded px-0.5 bg-violet-500/30 text-violet-100 transition-colors"
                      }
                    >
                      {replacement}
                    </span>
                    {after}
                  </div>
                );
              }

              // extend mode — original content stays put, ghost continuation
              // appended after a paragraph break in emerald-tint to mark it
              // as candidate not-yet-committed text.
              const ghost = isPending
                ? "…"
                : ia.alternatives[ia.currentIdx] ?? "";
              const ghostClass = isPending
                ? "rounded px-0.5 bg-emerald-500/15 text-emerald-300/70 animate-pulse"
                : isCommitting
                ? "rounded px-0.5 bg-emerald-500/40 text-emerald-100"
                : "rounded px-0.5 bg-emerald-500/20 text-emerald-100/95 transition-colors";
              return (
                <div
                  data-text-content
                  className="whitespace-pre-wrap cursor-text"
                  style={{ textWrap: "pretty" } as React.CSSProperties}
                >
                  {f.content}
                  {"\n\n"}
                  <span className={ghostClass}>{ghost}</span>
                </div>
              );
            })()
          ) : (
            <div
              data-text-content
              className="whitespace-pre-wrap select-text cursor-text"
              style={{ textWrap: "pretty" } as React.CSSProperties}
              onMouseUp={() => handleTextMouseUp(f.id, f.content)}
            >
              {f.content}
            </div>
          )}
        </div>
      </div>
    );
  }, [positions, semanticZoom, editingId, editText, dragState, ws.sequence,
      siblingGroups, handlePointerDown, handlePointerMove, handlePointerUp,
      handleTextMouseUp, startEdit, saveEdit, onSelectFragment, onZoneTransfer, enableWordLevel, onEdit, onGenerate,
      inlineAlts, mergeCandidate, onUnmerge]);

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
            stroke={isActive ? "rgba(168, 162, 158, 0.18)" : "rgba(168, 162, 158, 0.06)"}
            strokeWidth={isActive ? 1 : 0.6}
            strokeDasharray={isActive ? "none" : "3 6"}
            markerEnd={semanticZoom !== "dot" ? "url(#arrowhead)" : undefined}
          />
          {semanticZoom !== "dot" && (
            <text x={mx} y={my - 6} textAnchor="middle" fill="rgba(168, 162, 158, 0.22)" fontSize="10">
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
            title="Center and zoom-fit all content"
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
        <div className="text-[10px] text-stone-700" title="Sibling alternatives are hidden on canvas — see tree view to browse them">
          {sequenceFragments.length} active · {stageFragments.length} staged
          {unplacedFragments.length > 0 && <span className="text-stone-800"> · {unplacedFragments.length} alts hidden</span>}
          {generatingFragments.length > 0 && <span className="text-blue-700"> · {generatingFragments.length} gen</span>}
        </div>
      </div>

      {/* Pan/zoom canvas. cursor:grab hints that the empty background is
          drag-pannable; fragments override with their own cursors. */}
      <div ref={containerRef} className="w-full h-full"
        style={{ cursor: "grab" }}
        {...panZoomHandlers}>
        <div style={{
          transform: `translate(${panZoom.panX}px, ${panZoom.panY}px) scale(${panZoom.zoom})`,
          transformOrigin: "0 0",
        }}>
          {/* SVG edges + proximity gradient */}
          <svg className="absolute top-0 left-0 pointer-events-none" style={{ overflow: "visible", width: 1, height: 1 }}>
            <defs>
              <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="rgba(168, 162, 158, 0.18)" />
              </marker>
            </defs>

            {/* Proximity gradient (Experiment B): ambient teal connection
                between fragment pairs within r_flow. Two layered strokes —
                halo + core — so low-intensity pairs read as a soft glow
                and high-intensity pairs read as a confident bond.

                Experiment C overlay: the pair that is the active
                merge-candidate (already detected by the physics
                collision-merge) gets max intensity, no dashing, and the
                color of the merge type the spinner shows — so the
                gradient's vibe matches the merge variant the user is
                about to commit (blue=append, amber=prepend,
                violet=interleave, teal=summarize). */}
            {proximityPairs.map((p, i) => {
              const posA = positions[p.a];
              const posB = positions[p.b];
              const fA = ws.fragments[p.a];
              const fB = ws.fragments[p.b];
              if (!posA || !posB || !fA || !fB) return null;
              const hA = heightFor(fA);
              const hB = heightFor(fB);
              // Connect the closer pair of edges along the dominant axis so
              // the line emerges from the silhouettes rather than crossing
              // the bodies of both fragments.
              const cAx = posA.x + nodeWidth / 2;
              const cAy = posA.y + hA / 2;
              const cBx = posB.x + nodeWidth / 2;
              const cBy = posB.y + hB / 2;
              const dx = cBx - cAx;
              const dy = cBy - cAy;
              let x1: number, y1: number, x2: number, y2: number;
              if (Math.abs(dy) > Math.abs(dx)) {
                if (dy > 0) {
                  x1 = cAx; y1 = posA.y + hA;
                  x2 = cBx; y2 = posB.y;
                } else {
                  x1 = cAx; y1 = posA.y;
                  x2 = cBx; y2 = posB.y + hB;
                }
              } else {
                if (dx > 0) {
                  x1 = posA.x + nodeWidth; y1 = cAy;
                  x2 = posB.x; y2 = cBy;
                } else {
                  x1 = posA.x; y1 = cAy;
                  x2 = posB.x + nodeWidth; y2 = cBy;
                }
              }

              const isMergeCandidate = !!mergeCandidate &&
                ((mergeCandidate.draggedId === p.a && mergeCandidate.targetId === p.b) ||
                 (mergeCandidate.draggedId === p.b && mergeCandidate.targetId === p.a));

              // Ambient pairs are atmospheric — barely-there glow.
              // Merge-candidate pair gets a confident bond.
              const intensity = isMergeCandidate ? 1 : p.intensity;
              const haloOpacity = (isMergeCandidate ? 0.16 : 0.02) + (isMergeCandidate ? 0.30 : 0.12) * intensity;
              const coreOpacity = (isMergeCandidate ? 0.45 : 0.06) + (isMergeCandidate ? 0.30 : 0.18) * intensity;
              const haloWidth = (isMergeCandidate ? 12 : 4) + intensity * (isMergeCandidate ? 16 : 8);
              const coreWidth = (isMergeCandidate ? 1.5 : 0.6) + intensity * (isMergeCandidate ? 3.0 : 1.4);
              const haloRgb = isMergeCandidate ? MERGE_COLORS_RGB[mergeCandidate.mergeType] : "94, 234, 212";
              const coreRgb = isMergeCandidate ? MERGE_COLORS_RGB[mergeCandidate.mergeType] : "167, 243, 208";

              return (
                <g key={`prox-${i}`}>
                  <line
                    x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke={`rgba(${haloRgb}, ${haloOpacity})`}
                    strokeWidth={haloWidth}
                    strokeLinecap="round"
                  />
                  <line
                    x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke={`rgba(${coreRgb}, ${coreOpacity})`}
                    strokeWidth={coreWidth}
                    strokeDasharray={isMergeCandidate || intensity > 0.5 ? undefined : `${4 + intensity * 6} ${4}`}
                    strokeLinecap="round"
                  />
                </g>
              );
            })}

            {edgeElements}
          </svg>

          {/* Split toolbar */}
          {splitToolbar && semanticZoom === "full" && (
            <div className="absolute z-50 flex gap-1 bg-stone-800 border border-stone-600 rounded-lg shadow-xl px-1.5 py-1 -translate-x-1/2 -translate-y-full pointer-events-auto"
              style={{ left: splitToolbar.x, top: splitToolbar.y }}>
              <button onMouseDown={async (e) => {
                e.preventDefault();
                const frag = ws.fragments[splitToolbar.fragmentId];
                if (!frag) {
                  setSplitToolbar(null); window.getSelection()?.removeAllRanges();
                  return;
                }
                const selectedText = frag.content.slice(splitToolbar.charStart, splitToolbar.charEnd);
                const sourceId = splitToolbar.fragmentId;
                const charStart = splitToolbar.charStart;
                const charEnd = splitToolbar.charEnd;
                setInlineAlts({
                  mode: "replace",
                  sourceFragmentId: sourceId,
                  selectedText,
                  charStart,
                  charEnd,
                  state: "pending",
                  alternatives: [],
                  currentIdx: 0,
                  startedAt: Date.now(),
                });
                setSplitToolbar(null);
                window.getSelection()?.removeAllRanges();
                const result = await onReplace(sourceId, selectedText, frag.content);
                if (result && result.alternatives.length > 0) {
                  setInlineAlts((prev) => prev && prev.mode === "replace" && prev.sourceFragmentId === sourceId
                    ? { ...prev, state: "preview", alternatives: result.alternatives, currentIdx: 0 }
                    : prev);
                } else {
                  setInlineAlts(null);
                }
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
                height: [...stageFragments, ...unplacedFragments].reduce(
                  (acc, f) => acc + heightFor(f) + 20, 40
                ),
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

          {/* Merge preview (Experiment C v2) — during the merge-candidate
              hold, render an approximate continuous-prose preview of the
              two fragments laid out as one paragraph. It fades in as the
              hold timer counts up, while the two source fragments fade
              out (handled in renderFragment). The actual merge fires on
              commit via /api/tree/merge and Claude produces the final
              edited text — this preview is the visual deformation that
              answers the 'fragments deform as they approach' part of
              the vision. */}
          {mergeCandidate && positions[mergeCandidate.targetId] && positions[mergeCandidate.draggedId] && (() => {
            const targetFrag = ws.fragments[mergeCandidate.targetId];
            const sourceFrag = ws.fragments[mergeCandidate.draggedId];
            if (!targetFrag || !sourceFrag) return null;
            // Anchor the preview at the upper of the two fragments so it
            // visually "absorbs" both. Order: prefer the target's slot
            // since the merge inherits target position.
            const targetPos = positions[mergeCandidate.targetId];
            const sourcePos = positions[mergeCandidate.draggedId];
            const x = Math.min(targetPos.x, sourcePos.x);
            const y = Math.min(targetPos.y, sourcePos.y);
            return (
              <MergePreview
                x={x}
                y={y}
                width={nodeWidth}
                sourceContent={sourceFrag.content}
                targetContent={targetFrag.content}
                mergeType={mergeCandidate.mergeType}
                startedAt={mergeCandidate.startedAt}
                durationMs={MERGE_HOLD_MS}
                confirmed={mergeCandidate.confirmed}
              />
            );
          })()}

          {/* Merge spinner overlay (counts the hold time, color-coded by
              merge variant). Lives on top of the preview so the timer is
              still readable. */}
          {mergeCandidate && positions[mergeCandidate.targetId] && (
            <MergeSpinner
              x={positions[mergeCandidate.targetId].x}
              y={positions[mergeCandidate.targetId].y}
              nodeWidth={nodeWidth}
              nodeHeight={nodeH}
              startedAt={mergeCandidate.startedAt}
              durationMs={MERGE_HOLD_MS}
              mergeType={mergeCandidate.mergeType}
              confirmed={mergeCandidate.confirmed}
            />
          )}

          {/* Inline phrase reroll renders directly inside the source
              fragment's content (see renderFragment's FULL path) and
              uses the InlineRerollBadge floating above. No separate
              overlay component here. */}
        </div>
      </div>

    </div>
  );
}
