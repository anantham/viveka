"use client";

import { useEffect, useRef, useState } from "react";

type MergeType = "prepend" | "append" | "interleave" | "summarize";

const MERGE_COLORS: Record<MergeType, string> = {
  append: "#3b82f6",     // blue
  prepend: "#f59e0b",    // amber
  interleave: "#8b5cf6", // violet
  summarize: "#14b8a6",  // teal
};

const MERGE_LABELS: Record<MergeType, string> = {
  append: "append",
  prepend: "prepend",
  interleave: "weave",
  summarize: "distill",
};

interface MergeSpinnerProps {
  x: number;
  y: number;
  nodeWidth: number;
  nodeHeight: number;
  startedAt: number;
  durationMs: number;
  mergeType: MergeType;
  confirmed: boolean;
}

export function MergeSpinner({
  x, y, nodeWidth, nodeHeight,
  startedAt, durationMs, mergeType, confirmed,
}: MergeSpinnerProps) {
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (confirmed) {
      setProgress(1);
      return;
    }

    const animate = () => {
      const elapsed = Date.now() - startedAt;
      setProgress(Math.min(1, elapsed / durationMs));
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [startedAt, durationMs, confirmed]);

  const size = 48;
  const cx = x + nodeWidth / 2;
  const cy = y + nodeHeight / 2;
  const r = 18;
  const circumference = 2 * Math.PI * r;
  const color = MERGE_COLORS[mergeType];
  const label = MERGE_LABELS[mergeType];

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: cx - size / 2,
        top: cy - size / 2,
        width: size,
        height: size,
        zIndex: 60,
      }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background ring */}
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth={3}
        />
        {/* Progress ring */}
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          stroke={color}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={`${circumference * progress} ${circumference * (1 - progress)}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{
            transition: confirmed ? "none" : undefined,
            opacity: confirmed ? undefined : 0.8,
          }}
        />
        {confirmed && (
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none"
            stroke={color}
            strokeWidth={2}
            opacity={0.4}
            className="animate-ping"
          />
        )}
      </svg>
      {/* Label below */}
      <div
        className="absolute text-center w-full text-[9px] font-medium"
        style={{ top: size + 2, color, opacity: 0.9 }}
      >
        {confirmed ? "merging..." : label}
      </div>
    </div>
  );
}
