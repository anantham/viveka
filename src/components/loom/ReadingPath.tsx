"use client";

import { buildPathD, PathPoint, JunctionEdge } from "@/lib/canvas-utils";

interface ReadingPathProps {
  points: PathPoint[];
  ghostPoint?: PathPoint;
  junctionEdges?: JunctionEdge[];
}

/**
 * Build an SVG path "d" for a smooth junction edge from parent bottom to child top.
 * Uses a cubic bezier that drops vertically then curves to the child.
 */
function buildJunctionEdgeD(from: PathPoint, to: PathPoint): string {
  const midY = from.y + (to.y - from.y) * 0.5;
  return `M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`;
}

export default function ReadingPath({
  points,
  ghostPoint,
  junctionEdges = [],
}: ReadingPathProps) {
  const allPoints = ghostPoint ? [...points, ghostPoint] : points;
  const pathD = buildPathD(allPoints);

  if (allPoints.length < 2 && junctionEdges.length === 0) return null;

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{ width: "100%", height: "100%", overflow: "visible" }}
    >
      <defs>
        {/* End arrowhead */}
        <marker
          id="reading-arrow"
          viewBox="0 0 10 7"
          refX="9"
          refY="3.5"
          markerWidth="8"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <polygon points="0 0, 10 3.5, 0 7" fill="#57534e" />
        </marker>

        {/* Mid-path directional arrow (smaller, for intermediate waypoints) */}
        <marker
          id="reading-arrow-mid"
          viewBox="0 0 8 6"
          refX="4"
          refY="3"
          markerWidth="6"
          markerHeight="5"
          orient="auto"
        >
          <polygon points="0 0, 8 3, 0 6" fill="#57534e" opacity="0.7" />
        </marker>

        {/* Junction edge arrowhead (very small, subtle) */}
        <marker
          id="junction-arrow"
          viewBox="0 0 8 6"
          refX="7"
          refY="3"
          markerWidth="5"
          markerHeight="4"
          orient="auto"
        >
          <polygon points="0 0, 8 3, 0 6" fill="#a8a29e" />
        </marker>

        {/* Dimmed junction edge arrowhead for non-active siblings */}
        <marker
          id="junction-arrow-dim"
          viewBox="0 0 8 6"
          refX="7"
          refY="3"
          markerWidth="5"
          markerHeight="4"
          orient="auto"
        >
          <polygon points="0 0, 8 3, 0 6" fill="#292524" />
        </marker>
      </defs>

      {/* Main dotted reading path */}
      {allPoints.length >= 2 && (
        <path
          d={pathD}
          fill="none"
          stroke="#57534e"
          strokeWidth={1.5}
          strokeDasharray="6 4"
          markerMid="url(#reading-arrow-mid)"
          markerEnd="url(#reading-arrow)"
          opacity={0.6}
        />
      )}

      {/* Junction fork edges */}
      {junctionEdges.map((edge) => (
        <path
          key={`junction-${edge.parentId}-${edge.childId}`}
          d={buildJunctionEdgeD(edge.from, edge.to)}
          fill="none"
          stroke={edge.isActive ? "#a8a29e" : "#292524"}
          strokeWidth={edge.isActive ? 1.5 : 1}
          strokeDasharray={edge.isActive ? "none" : "4 3"}
          markerEnd={edge.isActive ? "url(#junction-arrow)" : "url(#junction-arrow-dim)"}
          opacity={edge.isActive ? 0.7 : 0.4}
        />
      ))}

      {/* Invisible waypoints for the reading path (badges rendered by CanvasView) */}
      {points.map((point, i) => (
        <g key={i}>
          <circle cx={point.x} cy={point.y} r={0} fill="transparent" />
        </g>
      ))}
    </svg>
  );
}
