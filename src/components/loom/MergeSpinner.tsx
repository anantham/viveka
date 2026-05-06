"use client";

import { useEffect, useRef, useState } from "react";

export type MergeType = "prepend" | "append" | "interleave" | "summarize";

export const MERGE_COLORS: Record<MergeType, string> = {
  append: "#3b82f6",     // blue
  prepend: "#f59e0b",    // amber
  interleave: "#8b5cf6", // violet
  summarize: "#14b8a6",  // teal
};

// Same colors as RGB triples so we can compose with alpha at render time.
export const MERGE_COLORS_RGB: Record<MergeType, string> = {
  append: "59, 130, 246",
  prepend: "245, 158, 11",
  interleave: "139, 92, 246",
  summarize: "20, 184, 166",
};

const MERGE_LABELS: Record<MergeType, string> = {
  append: "append",
  prepend: "prepend",
  interleave: "weave",
  summarize: "distill",
};

const MERGE_DESCRIPTIONS: Record<MergeType, string> = {
  append: "A then B, lightly stitched",
  prepend: "A before B, lightly stitched",
  interleave: "sentences from both, woven",
  summarize: "distilled into shorter synthesis",
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
  const description = MERGE_DESCRIPTIONS[mergeType];

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
      {/* Label below — prominent two-line readout so the writer doesn't
          have to memorize the color legend (blue=append, etc). */}
      <div
        className="absolute text-center font-mono"
        style={{
          top: size + 4,
          left: -80,
          width: size + 160,
        }}
      >
        <div
          className="text-[12px] font-semibold tracking-wide whitespace-nowrap"
          style={{ color }}
        >
          {confirmed ? "merging…" : `merge ▸ ${label}`}
        </div>
        {!confirmed && (
          <div className="text-[9px] text-stone-500 mt-0.5 whitespace-nowrap">
            {description}
          </div>
        )}
      </div>
    </div>
  );
}
