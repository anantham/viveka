"use client";

import { useEffect, useState } from "react";

/**
 * Tiny floating badge for the inline phrase-reroll preview. Three
 * states:
 *
 *   pending     — spinner + elapsed counter + ETA (LLM call in flight).
 *   preview     — current alt index of N + arrow hints + optional
 *                 spread-status indicator.
 *   committing  — brief "committing…" before the badge unmounts.
 *
 * Anchored above the source fragment so it doesn't displace text.
 */
export default function InlineRerollBadge({
  state,
  startedAt,
  currentIdx,
  total,
  spreadLoading,
  spreadActive,
}: {
  state: "pending" | "preview" | "committing";
  startedAt: number;
  currentIdx: number;
  total: number;
  spreadLoading?: boolean;
  spreadActive?: boolean;
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
  return (
    <div className="absolute -top-7 left-2 z-50 flex items-center gap-1.5 px-2 py-0.5 rounded bg-violet-950/80 border border-violet-600/70 text-[10px] text-violet-100 font-mono pointer-events-auto">
      <span className="text-violet-300">←</span>
      <span className="tabular-nums">
        {currentIdx + 1}/{total}
      </span>
      <span className="text-violet-300">→</span>
      {spreadLoading ? (
        <span className="text-violet-400/80 ml-1 animate-pulse">spreading…</span>
      ) : spreadActive ? (
        <span className="text-emerald-300/80 ml-1">spread ✓</span>
      ) : null}
      <span className="text-violet-500/80 ml-1">↵ pick · esc revert</span>
    </div>
  );
}
