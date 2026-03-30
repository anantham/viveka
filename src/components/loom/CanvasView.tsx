"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { ConversationTree, TreeNode, getActivePath } from "@/lib/tree";
import {
  CursorTool,
  NodePositions,
  computeReadingOrder,
  computeDefaultPositions,
  computeColumnPositions,
  computeGhostPosition,
  computePathPoints,
  isInContext,
  cycleTool,
} from "@/lib/canvas-utils";
import { usePanZoom } from "@/hooks/usePanZoom";
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

const NODE_WIDTH = 480;
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
    computeDefaultPositions(activeNodeIds, COLUMN_CENTER_FALLBACK * 2, NODE_WIDTH)
  );
  const [nodeHeights, setNodeHeights] = useState<Record<string, number>>({});
  const [cursorTool, setCursorTool] = useState<CursorTool>("hand");
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("canvas");
  const [isAnimating, setIsAnimating] = useState(false);
  const savedFreeformPositions = useRef<NodePositions>({});
  const viewportRef = useRef<HTMLDivElement>(null);

  const { state: panZoom, containerRef, handlers: panZoomHandlers, startCanvasPan, resetView } =
    usePanZoom();

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

      // Find the max Y of existing positioned nodes
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
            x: columnCenterX - NODE_WIDTH / 2,
            y: maxY,
          };
          maxY += nodeHeights[id] ?? 80;
        }
      }

      return needsUpdate ? updated : prev;
    });
  }, [activeNodeIds, columnCenterX, nodeHeights]);

  // --- Derived computations ---

  // Which nodes are in-context (inside the reading column)
  const inContextNodeIds = useMemo(() => {
    return activeNodeIds.filter((id) => {
      const pos = positions[id];
      if (!pos) return false;
      return isInContext(pos.x, NODE_WIDTH, columnCenterX);
    });
  }, [activeNodeIds, positions, columnCenterX]);

  // Reading order (only in-context nodes)
  const readingOrder = useMemo(
    () => computeReadingOrder(inContextNodeIds, positions),
    [inContextNodeIds, positions]
  );

  // Reading path SVG points
  const pathPoints = useMemo(
    () => computePathPoints(readingOrder, positions, NODE_WIDTH, nodeHeights),
    [readingOrder, positions, nodeHeights]
  );

  // Ghost node position
  const ghostPosition = useMemo(
    () => computeGhostPosition(readingOrder, positions, nodeHeights),
    [readingOrder, positions, nodeHeights]
  );

  // Ghost point for the path arrow
  const ghostPathPoint = useMemo(
    () => ({
      x: ghostPosition.x + NODE_WIDTH / 2,
      y: ghostPosition.y + 25,
    }),
    [ghostPosition]
  );

  // Reading order index map for badges
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

  // Layout mode toggle
  const toggleLayoutMode = useCallback(() => {
    if (layoutMode === "canvas") {
      // Save current positions, animate to column
      savedFreeformPositions.current = { ...positions };
      const columnPositions = computeColumnPositions(
        readingOrder,
        columnCenterX,
        NODE_WIDTH,
        nodeHeights
      );
      setIsAnimating(true);
      setPositions((prev) => ({ ...prev, ...columnPositions }));
      setLayoutMode("column");
      setTimeout(() => setIsAnimating(false), 450);
    } else {
      // Restore saved free-form positions
      setIsAnimating(true);
      if (Object.keys(savedFreeformPositions.current).length > 0) {
        setPositions(savedFreeformPositions.current);
      }
      setLayoutMode("canvas");
      setTimeout(() => setIsAnimating(false), 450);
    }
  }, [layoutMode, positions, readingOrder, columnCenterX, nodeHeights]);

  // Cursor tool cycling via scroll (only when not over a node with selection)
  const handleToolScroll = useCallback(
    (e: React.WheelEvent) => {
      // Don't cycle if Ctrl is held (that's zoom)
      if (e.ctrlKey || e.metaKey) return;

      // Check if there's a text selection (minimum 1 word)
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.toString().trim().length >= 2) {
        // Selection active — scroll should do local reroll (Phase 2)
        return;
      }

      const direction = e.deltaY > 0 ? 1 : -1;
      setCursorTool((prev) => cycleTool(prev, direction as 1 | -1));
    },
    []
  );

  // Keyboard shortcuts for tools
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

  // --- Canvas click handler (pan in hand mode) ---
  const handleCanvasPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Only if clicking the canvas itself, not a node
      if (e.target === e.currentTarget && cursorTool === "hand") {
        startCanvasPan(e);
      }
      // Also handle middle-click pan regardless of tool
      panZoomHandlers.onPointerDown(e);
    },
    [cursorTool, startCanvasPan, panZoomHandlers]
  );

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
      onWheel={handleToolScroll}
    >
      {/* Toolbar — viewport space (not transformed) */}
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
      </div>

      {/* Reading order legend — bottom left */}
      <div className="absolute bottom-3 left-3 z-30 text-[10px] text-stone-600">
        {readingOrder.length} blocks in context
        {readingOrder.length > 0 && (
          <span className="ml-2">
            · zoom {Math.round(panZoom.zoom * 100)}%
          </span>
        )}
      </div>

      {/* Transform container — this is where pan/zoom happens */}
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{
          transform: `translate3d(${panZoom.panX}px, ${panZoom.panY}px, 0) scale(${panZoom.zoom})`,
          transformOrigin: "0 0",
        }}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={panZoomHandlers.onPointerMove}
        onPointerUp={panZoomHandlers.onPointerUp}
      >
        {/* Column indicator — faint vertical band */}
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
              nodeWidth={NODE_WIDTH}
              zoom={panZoom.zoom}
              onTextDrop={handleTextDrop}
              onEdit={onNodeEdit}
            />
          );
        })}

        {/* Ghost node */}
        <GhostNode
          position={ghostPosition}
          nodeWidth={NODE_WIDTH}
          onGenerate={onGenerate}
          isGenerating={isGenerating}
        />

        {/* Reading order badges (rendered as absolute overlays) */}
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
