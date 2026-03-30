// Canvas utility functions — pure logic, no React dependency

export type CursorTool = "select" | "tangent" | "hand";

export interface NodePosition {
  x: number;
  y: number;
}

export type NodePositions = Record<string, NodePosition>;

// --- Reading order ---

const Y_THRESHOLD = 20; // px — nodes within this Y range are considered "same row"

/**
 * Sort node IDs by reading order: Y position primary, X tiebreak (left→right).
 * Only includes nodes that are in-context.
 */
export function computeReadingOrder(
  nodeIds: string[],
  positions: NodePositions
): string[] {
  return [...nodeIds]
    .filter((id) => positions[id] !== undefined)
    .sort((a, b) => {
      const posA = positions[a];
      const posB = positions[b];
      const dy = posA.y - posB.y;
      if (Math.abs(dy) > Y_THRESHOLD) return dy;
      return posA.x - posB.x;
    });
}

// --- In-context detection ---

const DEFAULT_COLUMN_HALF_WIDTH = 250;

/**
 * Check if a node's X position places it within the "reading column" (in-context).
 */
export function isInContext(
  nodeX: number,
  nodeWidth: number,
  columnCenterX: number,
  columnHalfWidth: number = DEFAULT_COLUMN_HALF_WIDTH
): boolean {
  const nodeCenterX = nodeX + nodeWidth / 2;
  return Math.abs(nodeCenterX - columnCenterX) < columnHalfWidth;
}

// --- Column layout positions ---

const DEFAULT_NODE_SPACING = 20; // gap between nodes
const DEFAULT_START_Y = 40;

/**
 * Compute positions for linear column layout.
 * Nodes stack vertically, centered on columnCenterX.
 */
export function computeColumnPositions(
  nodeIds: string[],
  columnCenterX: number,
  nodeWidth: number = 480,
  nodeHeights: Record<string, number> = {},
  startY: number = DEFAULT_START_Y,
  spacing: number = DEFAULT_NODE_SPACING
): NodePositions {
  const positions: NodePositions = {};
  let currentY = startY;

  for (const id of nodeIds) {
    positions[id] = {
      x: columnCenterX - nodeWidth / 2,
      y: currentY,
    };
    const height = nodeHeights[id] ?? 80; // fallback estimate
    currentY += height + spacing;
  }

  return positions;
}

// --- Default canvas positions (initial layout for a tree) ---

/**
 * Compute default free-form positions for nodes based on tree active path.
 * Starts them in a column layout that can then be freely rearranged.
 */
export function computeDefaultPositions(
  nodeIds: string[],
  canvasWidth: number,
  nodeWidth: number = 480
): NodePositions {
  const columnCenterX = canvasWidth / 2;
  return computeColumnPositions(nodeIds, columnCenterX, nodeWidth);
}

// --- Cursor tool cycling ---

const TOOL_ORDER: CursorTool[] = ["select", "tangent", "hand"];

export function cycleTool(current: CursorTool, direction: 1 | -1 = 1): CursorTool {
  const idx = TOOL_ORDER.indexOf(current);
  const next = (idx + direction + TOOL_ORDER.length) % TOOL_ORDER.length;
  return TOOL_ORDER[next];
}

// --- Ghost node position ---

/**
 * Compute where the ghost node should appear: below the last in-context node.
 */
export function computeGhostPosition(
  readingOrder: string[],
  positions: NodePositions,
  nodeHeights: Record<string, number>,
  spacing: number = DEFAULT_NODE_SPACING
): NodePosition {
  if (readingOrder.length === 0) {
    return { x: 0, y: DEFAULT_START_Y };
  }

  const lastId = readingOrder[readingOrder.length - 1];
  const lastPos = positions[lastId];
  const lastHeight = nodeHeights[lastId] ?? 80;

  return {
    x: lastPos.x,
    y: lastPos.y + lastHeight + spacing + 10,
  };
}

// --- Reading path points (for SVG) ---

export interface PathPoint {
  x: number;
  y: number;
}

/**
 * Compute center points for the reading path arrow.
 */
export function computePathPoints(
  readingOrder: string[],
  positions: NodePositions,
  nodeWidth: number = 480,
  nodeHeights: Record<string, number> = {}
): PathPoint[] {
  return readingOrder.map((id) => {
    const pos = positions[id];
    const height = nodeHeights[id] ?? 80;
    return {
      x: pos.x + nodeWidth / 2,
      y: pos.y + height / 2,
    };
  });
}

/**
 * Build an SVG path string from path points.
 */
export function buildPathD(points: PathPoint[]): string {
  if (points.length === 0) return "";
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");
}
