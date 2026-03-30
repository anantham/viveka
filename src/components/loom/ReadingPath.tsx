"use client";

import { buildPathD, PathPoint } from "@/lib/canvas-utils";

interface ReadingPathProps {
  points: PathPoint[];
  ghostPoint?: PathPoint;
}

export default function ReadingPath({ points, ghostPoint }: ReadingPathProps) {
  const allPoints = ghostPoint ? [...points, ghostPoint] : points;
  const pathD = buildPathD(allPoints);

  if (allPoints.length < 2) return null;

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{ width: "100%", height: "100%", overflow: "visible" }}
    >
      <defs>
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
      </defs>

      {/* Main dotted path */}
      <path
        d={pathD}
        fill="none"
        stroke="#57534e"
        strokeWidth={1.5}
        strokeDasharray="6 4"
        markerEnd="url(#reading-arrow)"
        opacity={0.6}
      />

      {/* Number badges along the path */}
      {points.map((point, i) => (
        <g key={i}>
          <circle
            cx={point.x}
            cy={point.y}
            r={0}
            fill="transparent"
          />
          {/* Badges are rendered by CanvasNode, not here */}
        </g>
      ))}
    </svg>
  );
}
