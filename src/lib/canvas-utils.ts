// Canvas utility functions — pure logic, no React dependency

// ---------------------------------------------------------------------------
// fitToBox math (used by usePanZoom)
// ---------------------------------------------------------------------------

export interface FitToBoxArgs {
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  viewport: { width: number; height: number };
  paddingFraction?: number;
  maxFitZoom?: number;
  minZoom?: number;
  maxZoom?: number;
}

export interface FitToBoxResult {
  panX: number;
  panY: number;
  zoom: number;
}

/**
 * Pan + zoom that fits a content bbox (in canvas-content coords, before
 * pan/zoom) into a viewport. `maxFitZoom` caps the auto-zoom-in case so
 * a single tiny fragment doesn't fill the whole screen.
 */
export function computeFitToBox(args: FitToBoxArgs): FitToBoxResult {
  const {
    bbox,
    viewport,
    paddingFraction = 0.1,
    maxFitZoom = 1.5,
    minZoom = 0.15,
    maxZoom = 3,
  } = args;

  const bboxW = Math.max(1, bbox.maxX - bbox.minX);
  const bboxH = Math.max(1, bbox.maxY - bbox.minY);
  const padX = viewport.width * paddingFraction;
  const padY = viewport.height * paddingFraction;
  const availW = Math.max(1, viewport.width - 2 * padX);
  const availH = Math.max(1, viewport.height - 2 * padY);
  const rawZoom = Math.min(availW / bboxW, availH / bboxH);
  const fitZoom = Math.min(maxFitZoom, Math.min(maxZoom, Math.max(minZoom, rawZoom)));

  const bboxCenterX = (bbox.minX + bbox.maxX) / 2;
  const bboxCenterY = (bbox.minY + bbox.maxY) / 2;
  const panX = viewport.width / 2 - fitZoom * bboxCenterX;
  const panY = viewport.height / 2 - fitZoom * bboxCenterY;

  return { panX, panY, zoom: fitZoom };
}

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

// --- Junction detection ---

export interface JunctionEdge {
  /** The parent node ID at the fork */
  parentId: string;
  /** The child node ID */
  childId: string;
  /** Start point (bottom-center of parent) */
  from: PathPoint;
  /** End point (top-center of child) */
  to: PathPoint;
  /** Whether this child is on the active/selected path */
  isActive: boolean;
}

/**
 * Detect junction nodes (nodes with multiple non-pruned children) and compute
 * the edge lines from parent to each child at that junction.
 *
 * @param nodes - all tree nodes keyed by ID
 * @param activeNodeIds - set of node IDs currently on the active path
 * @param positions - current canvas positions for all visible nodes
 * @param nodeWidth - current node width (for centering)
 * @param nodeHeights - measured node heights
 */
export function computeJunctionEdges(
  nodes: Record<string, { id: string; childIds: string[]; parentId: string | null; pruned: boolean; role: string }>,
  activeNodeIds: string[],
  positions: NodePositions,
  nodeWidth: number,
  nodeHeights: Record<string, number>
): JunctionEdge[] {
  const activeSet = new Set(activeNodeIds);
  const edges: JunctionEdge[] = [];

  for (const id of activeNodeIds) {
    const node = nodes[id];
    if (!node) continue;

    // Only consider nodes with multiple non-pruned, non-system children
    const visibleChildren = node.childIds.filter((cid) => {
      const child = nodes[cid];
      return child && !child.pruned && child.role !== "system";
    });

    if (visibleChildren.length < 2) continue;

    const parentPos = positions[id];
    if (!parentPos) continue;
    const parentHeight = nodeHeights[id] ?? 80;

    // Bottom-center of parent
    const fromPoint: PathPoint = {
      x: parentPos.x + nodeWidth / 2,
      y: parentPos.y + parentHeight,
    };

    for (const childId of visibleChildren) {
      const childPos = positions[childId];
      if (!childPos) continue;

      // Top-center of child
      const toPoint: PathPoint = {
        x: childPos.x + nodeWidth / 2,
        y: childPos.y,
      };

      edges.push({
        parentId: id,
        childId,
        from: fromPoint,
        to: toPoint,
        isActive: activeSet.has(childId),
      });
    }
  }

  return edges;
}
