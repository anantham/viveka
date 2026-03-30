"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { ConversationTree, getActivePath } from "@/lib/tree";
import {
  CursorTool,
  NodePositions,
  computeReadingOrder,
  computeDefaultPositions,
  computeColumnPositions,
  computeGhostPosition,
  computePathPoints,
  isInContext,
} from "@/lib/canvas-utils";
import { usePanZoom } from "@/hooks/usePanZoom";
import { useFlipTransition } from "@/hooks/useFlipTransition";
import { timedMeasure, getReport, getStats } from "@/lib/layout-perf";
import CanvasNode from "./CanvasNode";
import ReadingPath from "./ReadingPath";
import CursorToolSwitcher from "./CursorToolSwitcher";
import GhostNode from "./GhostNode";

interface CanvasViewProps {
  tree: ConversationTree;
  onGenerate: () => void;
  onNodeSelect: (nodeId: string) => void;
  onNodeEdit: (nodeId: string, content: string) => void;
  isGenerating: boolean;
}

type LayoutMode = "canvas" | "column";

const NODE_WIDTH_CANVAS = 480;
const NODE_WIDTH_COLUMN = 600;
const COLUMN_CENTER_FALLBACK = 600;

export default function CanvasView({
  tree,
  onGenerate,
  onNodeSelect,
  onNodeEdit,
  isGenerating,
}: CanvasViewProps) {
  const activePath = getActivePath(tree);
  const activeNodeIds = activePath
    .filter((n) => n.role !== "system")
    .map((n) => n.id);

  // --- State ---
  const [positions, setPositions] = useState<NodePositions>(() =>
    computeDefaultPositions(activeNodeIds, COLUMN_CENTER_FALLBACK * 2, NODE_WIDTH_CANVAS)
  );
  const [nodeHeights, setNodeHeights] = useState<Record<string, number>>({});
  const [cursorTool, setCursorTool] = useState<CursorTool>("hand");
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("canvas");
  const [isAnimating, setIsAnimating] = useState(false);
  const [showPerfOverlay, setShowPerfOverlay] = useState(false);
  const savedFreeformPositions = useRef<NodePositions>({});
  const viewportRef = useRef<HTMLDivElement>(null);

  // Current node width depends on layout mode
  const nodeWidth = layoutMode === "column" ? NODE_WIDTH_COLUMN : NODE_WIDTH_CANVAS;

  const { state: panZoom, containerRef, handlers: panZoomHandlers, startCanvasPan, resetView } =
    usePanZoom();

  const { snapshotFirst, animateFlip } = useFlipTransition();

  // --- Compute column center from viewport width ---
  const [columnCenterX, setColumnCenterX] = useState(COLUMN_CENTER_FALLBACK);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setColumnCenterX(entry.contentRect.width / 2);
      }
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  // Initialize positions for new nodes that don't have positions yet
  useEffect(() => {
    setPositions((prev) => {
      const updated = { ...prev };
      let needsUpdate = false;
      let maxY = 0;

      for (const id of activeNodeIds) {
        if (prev[id]) {
          const h = nodeHeights[id] ?? 80;
          maxY = Math.max(maxY, prev[id].y + h);
        }
      }

      for (const id of activeNodeIds) {
        if (!prev[id]) {
          needsUpdate = true;
          maxY += 20;
          updated[id] = {
            x: columnCenterX - NODE_WIDTH_CANVAS / 2,
            y: maxY,
          };
          maxY += nodeHeights[id] ?? 80;
        }
      }

      return needsUpdate ? updated : prev;
    });
  }, [activeNodeIds, columnCenterX, nodeHeights]);

  // --- Derived computations ---

  const inContextNodeIds = useMemo(() => {
    return activeNodeIds.filter((id) => {
      const pos = positions[id];
      if (!pos) return false;
      return isInContext(pos.x, nodeWidth, columnCenterX);
    });
  }, [activeNodeIds, positions, columnCenterX, nodeWidth]);

  const readingOrder = useMemo(
    () => computeReadingOrder(inContextNodeIds, positions),
    [inContextNodeIds, positions]
  );

  const pathPoints = useMemo(
    () => computePathPoints(readingOrder, positions, nodeWidth, nodeHeights),
    [readingOrder, positions, nodeHeights, nodeWidth]
  );

  const ghostPosition = useMemo(
    () => computeGhostPosition(readingOrder, positions, nodeHeights),
    [readingOrder, positions, nodeHeights]
  );

  const ghostPathPoint = useMemo(
    () => ({
      x: ghostPosition.x + nodeWidth / 2,
      y: ghostPosition.y + 25,
    }),
    [ghostPosition, nodeWidth]
  );

  const readingOrderIndex = useMemo(() => {
    const map: Record<string, number> = {};
    readingOrder.forEach((id, i) => {
      map[id] = i + 1;
    });
    return map;
  }, [readingOrder]);

  // --- Handlers ---

  const handlePositionChange = useCallback(
    (id: string, pos: { x: number; y: number }) => {
      setPositions((prev) => ({ ...prev, [id]: pos }));
    },
    []
  );

  const handleHeightMeasured = useCallback(
    (id: string, height: number) => {
      setNodeHeights((prev) => {
        if (prev[id] === height) return prev;
        return { ...prev, [id]: height };
      });
    },
    []
  );

  // --- FLIP layout mode toggle ---
  const toggleLayoutMode = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;

    // Step 1: FLIP snapshot (First)
    snapshotFirst(activeNodeIds, container);

    if (layoutMode === "canvas") {
      // Save freeform positions before switching
      savedFreeformPositions.current = { ...positions };

      // Compute destination column positions at the wider column width
      const columnPositions = computeColumnPositions(
        readingOrder,
        columnCenterX,
        NODE_WIDTH_COLUMN,
        nodeHeights
      );

      // Apply new positions + width (this triggers re-render = "Last")
      setIsAnimating(true);
      setLayoutMode("column");
      setPositions((prev) => ({ ...prev, ...columnPositions }));

      // Step 2: After React renders, run FLIP animation
      requestAnimationFrame(() => {
        // Measure destination heights at column width (the expensive DOM measurement)
        animateFlip(
          activeNodeIds,
          container,
          NODE_WIDTH_COLUMN,
          (heights) => setNodeHeights((prev) => ({ ...prev, ...heights })),
          400
        ).then(() => {
          setIsAnimating(false);
        });
      });
    } else {
      // Restore freeform positions
      setIsAnimating(true);
      setLayoutMode("canvas");

      if (Object.keys(savedFreeformPositions.current).length > 0) {
        setPositions(savedFreeformPositions.current);
      }

      requestAnimationFrame(() => {
        animateFlip(
          activeNodeIds,
          container,
          NODE_WIDTH_CANVAS,
          (heights) => setNodeHeights((prev) => ({ ...prev, ...heights })),
          400
        ).then(() => {
          setIsAnimating(false);
        });
      });
    }
  }, [
    layoutMode,
    positions,
    readingOrder,
    columnCenterX,
    nodeHeights,
    activeNodeIds,
    containerRef,
    snapshotFirst,
    animateFlip,
  ]);

  // Scroll-to-cycle removed — use keyboard shortcuts (1/2/3) instead

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;

      switch (e.key) {
        case "1":
          setCursorTool("select");
          break;
        case "2":
          setCursorTool("tangent");
          break;
        case "3":
          setCursorTool("hand");
          break;
        case "0":
          resetView();
          break;
        case "p":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            setShowPerfOverlay((v) => !v);
          }
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [resetView]);

  // --- Text snippet operations ---

  const handleTextDrop = useCallback(
    (targetNodeId: string, insertPosition: number, text: string) => {
      const targetNode = tree.nodes[targetNodeId];
      if (!targetNode) return;

      const newContent =
        targetNode.content.slice(0, insertPosition) +
        (insertPosition > 0 && insertPosition < targetNode.content.length ? "\n" : "") +
        text +
        (insertPosition < targetNode.content.length ? "\n" : "") +
        targetNode.content.slice(insertPosition);

      onNodeEdit(targetNodeId, newContent);
    },
    [tree.nodes, onNodeEdit]
  );

  // --- Tangent tool: select text → extract as new node ---
  const handleTangentExtract = useCallback(() => {
    if (cursorTool !== "tangent") return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const selectedText = selection.toString().trim();
    if (selectedText.length < 2) return;

    // Find which node the selection is in
    const anchorEl = selection.anchorNode?.parentElement?.closest("[data-node-id]");
    const sourceNodeId = anchorEl?.getAttribute("data-node-id");

    if (sourceNodeId && tree.nodes[sourceNodeId]) {
      // Create a new tangent node via API
      fetch("/api/tree/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          treeId: tree.id,
          parentId: sourceNodeId,
          userMessage: selectedText,
          count: 1,
        }),
      }).then(() => {
        // Clear selection
        selection.removeAllRanges();
      });
    }
  }, [cursorTool, tree]);

  // --- Canvas click handler ---
  const handleCanvasPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.target === e.currentTarget && cursorTool === "hand") {
        startCanvasPan(e);
      }
      panZoomHandlers.onPointerDown(e);
    },
    [cursorTool, startCanvasPan, panZoomHandlers]
  );

  // --- Perf stats for overlay ---
  const perfStats = useMemo(() => {
    if (!showPerfOverlay) return null;
    return {
      measureHeights: getStats("measure-heights"),
      flipSnapshot: getStats("flip-snapshot"),
      flipApply: getStats("flip-apply"),
      fullTransition: getStats("full-transition"),
      report: getReport(),
    };
  }, [showPerfOverlay, isAnimating]); // re-compute after transitions

  const cursorClass =
    cursorTool === "hand"
      ? "cursor-grab"
      : cursorTool === "select"
        ? "cursor-text"
        : "cursor-crosshair";

  return (
    <div
      ref={viewportRef}
      className={`relative w-full h-full overflow-hidden bg-stone-950 ${cursorClass}`}
    >
      {/* Toolbar — viewport space */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3">
        <CursorToolSwitcher
          activeTool={cursorTool}
          onToolChange={setCursorTool}
        />

        <button
          onClick={toggleLayoutMode}
          className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
            layoutMode === "column"
              ? "bg-stone-700 border-stone-500 text-stone-200"
              : "bg-stone-900/90 border-stone-700 text-stone-500 hover:text-stone-300"
          }`}
        >
          {layoutMode === "canvas" ? "column view" : "canvas view"}
        </button>

        <button
          onClick={resetView}
          className="px-2 py-1.5 text-xs rounded-lg border border-stone-700 bg-stone-900/90 text-stone-500 hover:text-stone-300 transition-colors"
          title="Reset zoom (0)"
        >
          1:1
        </button>

        <button
          onClick={() => setShowPerfOverlay((v) => !v)}
          className={`px-2 py-1.5 text-xs rounded-lg border transition-colors ${
            showPerfOverlay
              ? "bg-amber-900/50 border-amber-700 text-amber-300"
              : "bg-stone-900/90 border-stone-700 text-stone-600 hover:text-stone-400"
          }`}
          title="Toggle perf overlay (Ctrl+P)"
        >
          perf
        </button>
      </div>

      {/* Status bar — bottom left */}
      <div className="absolute bottom-3 left-3 z-30 text-[10px] text-stone-600">
        {readingOrder.length} blocks in context
        <span className="ml-2">· zoom {Math.round(panZoom.zoom * 100)}%</span>
        <span className="ml-2">· {nodeWidth}px wide</span>
      </div>

      {/* Performance overlay */}
      {showPerfOverlay && perfStats && (
        <div className="absolute top-14 right-3 z-40 bg-stone-900/95 border border-stone-700 rounded-lg p-3 text-[10px] font-mono text-stone-400 max-w-xs backdrop-blur-sm">
          <div className="text-stone-300 mb-2 text-xs">Layout Performance</div>

          {perfStats.fullTransition && (
            <div className="mb-2">
              <div className="text-amber-400">full-transition</div>
              <div>avg: {perfStats.fullTransition.avgMs.toFixed(1)}ms</div>
              <div>max: {perfStats.fullTransition.maxMs.toFixed(1)}ms</div>
              <div>p95: {perfStats.fullTransition.p95Ms.toFixed(1)}ms</div>
              <div>samples: {perfStats.fullTransition.count}</div>
            </div>
          )}

          {perfStats.measureHeights && (
            <div className="mb-2">
              <div className="text-blue-400">measure-heights (DOM reflow)</div>
              <div>avg: {perfStats.measureHeights.avgMs.toFixed(2)}ms</div>
              <div>max: {perfStats.measureHeights.maxMs.toFixed(2)}ms</div>
              <div>p95: {perfStats.measureHeights.p95Ms.toFixed(2)}ms</div>
              <div>avg nodes: {perfStats.measureHeights.avgNodesPerOp.toFixed(0)}</div>
            </div>
          )}

          {perfStats.flipSnapshot && (
            <div className="mb-2">
              <div className="text-green-400">flip-snapshot (getBoundingClientRect)</div>
              <div>avg: {perfStats.flipSnapshot.avgMs.toFixed(2)}ms</div>
              <div>max: {perfStats.flipSnapshot.maxMs.toFixed(2)}ms</div>
            </div>
          )}

          {perfStats.flipApply && (
            <div className="mb-2">
              <div className="text-purple-400">flip-apply (Web Animations)</div>
              <div>avg: {perfStats.flipApply.avgMs.toFixed(2)}ms</div>
              <div>max: {perfStats.flipApply.maxMs.toFixed(2)}ms</div>
            </div>
          )}

          {/* Verdict */}
          <div className="mt-2 pt-2 border-t border-stone-700">
            {perfStats.measureHeights && perfStats.measureHeights.p95Ms > 8 ? (
              <div className="text-red-400">
                DOM measurement p95 &gt; 8ms — Pretext would help
              </div>
            ) : perfStats.measureHeights && perfStats.measureHeights.p95Ms > 4 ? (
              <div className="text-amber-400">
                DOM measurement p95 4-8ms — borderline
              </div>
            ) : perfStats.measureHeights ? (
              <div className="text-green-400">
                DOM measurement p95 &lt; 4ms — Pretext not needed
              </div>
            ) : (
              <div className="text-stone-500">
                Toggle layout to collect measurements
              </div>
            )}
          </div>

          <button
            onClick={() => console.log(perfStats.report)}
            className="mt-2 text-stone-500 hover:text-stone-300 underline"
          >
            dump to console
          </button>
        </div>
      )}

      {/* Transform container */}
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{
          transform: `translate3d(${panZoom.panX}px, ${panZoom.panY}px, 0) scale(${panZoom.zoom})`,
          transformOrigin: "0 0",
        }}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={panZoomHandlers.onPointerMove}
        onPointerUp={(e) => {
          panZoomHandlers.onPointerUp(e);
          // After pointer up, check for tangent text extraction
          setTimeout(handleTangentExtract, 10);
        }}
      >
        {/* Column indicator */}
        <div
          className="absolute pointer-events-none"
          style={{
            left: columnCenterX - 250,
            top: 0,
            width: 500,
            height: 10000,
            background:
              "linear-gradient(90deg, transparent, rgba(120,113,108,0.03) 20%, rgba(120,113,108,0.05) 50%, rgba(120,113,108,0.03) 80%, transparent)",
          }}
        />

        {/* Reading path SVG */}
        <ReadingPath
          points={pathPoints}
          ghostPoint={readingOrder.length > 0 ? ghostPathPoint : undefined}
        />

        {/* Nodes */}
        {activeNodeIds.map((nodeId) => {
          const node = tree.nodes[nodeId];
          const pos = positions[nodeId];
          if (!node || !pos) return null;

          return (
            <CanvasNode
              key={nodeId}
              node={node}
              position={pos}
              onPositionChange={handlePositionChange}
              onHeightMeasured={handleHeightMeasured}
              inContext={inContextNodeIds.includes(nodeId)}
              isAnimating={isAnimating}
              cursorTool={cursorTool}
              nodeWidth={nodeWidth}
              zoom={panZoom.zoom}
              onTextDrop={handleTextDrop}
              onEdit={onNodeEdit}
            />
          );
        })}

        {/* Ghost node */}
        <GhostNode
          position={ghostPosition}
          nodeWidth={nodeWidth}
          onGenerate={onGenerate}
          isGenerating={isGenerating}
        />

        {/* Reading order badges */}
        {readingOrder.map((nodeId) => {
          const pos = positions[nodeId];
          if (!pos) return null;
          const idx = readingOrderIndex[nodeId];
          return (
            <div
              key={`badge-${nodeId}`}
              className="absolute pointer-events-none bg-stone-600 text-stone-200 text-[10px] font-mono rounded-full w-5 h-5 flex items-center justify-center"
              style={{
                left: pos.x - 10,
                top: pos.y - 8,
                transition: isAnimating ? "left 400ms ease-out, top 400ms ease-out" : "none",
              }}
            >
              {idx}
            </div>
          );
        })}
      </div>
    </div>
  );
}
