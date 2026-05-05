"use client";

import { useEffect, useRef, useState } from "react";
import type { Fragment } from "@/lib/workspace";

interface InlineAlternativesPanelProps {
  anchorX: number;
  anchorY: number;
  width: number;
  state: "pending" | "ready" | "committing";
  startedAt: number;
  selectedText: string;
  siblings: Fragment[];
  onPick: (siblingId: string) => void;
  onDismiss: () => void;
}

const GHOST_COLORS = [
  { stripe: "border-l-mint-400 bg-emerald-950/30 text-emerald-100/90", border: "border-l-emerald-400/60", text: "text-emerald-100/95" },
  { stripe: "border-l-violet-400 bg-violet-950/25 text-violet-100/90", border: "border-l-violet-400/60", text: "text-violet-100/95" },
  { stripe: "border-l-amber-400 bg-amber-950/25 text-amber-100/90", border: "border-l-amber-400/60", text: "text-amber-100/95" },
  { stripe: "border-l-rose-400 bg-rose-950/25 text-rose-100/90", border: "border-l-rose-400/60", text: "text-rose-100/95" },
  { stripe: "border-l-cyan-400 bg-cyan-950/25 text-cyan-100/90", border: "border-l-cyan-400/60", text: "text-cyan-100/95" },
];

// Diff one phrase against another to highlight the part that changed.
// Cheap longest-common-prefix / longest-common-suffix split.
function diffSpan(original: string, alternative: string): { before: string; old: string; replacement: string; after: string } {
  let p = 0;
  while (p < original.length && p < alternative.length && original[p] === alternative[p]) p++;
  let s = 0;
  while (
    s < original.length - p &&
    s < alternative.length - p &&
    original[original.length - 1 - s] === alternative[alternative.length - 1 - s]
  ) s++;
  return {
    before: original.slice(0, p),
    old: original.slice(p, original.length - s),
    replacement: alternative.slice(p, alternative.length - s),
    after: original.slice(original.length - s),
  };
}

export default function InlineAlternativesPanel({
  anchorX,
  anchorY,
  width,
  state,
  startedAt,
  selectedText,
  siblings,
  onPick,
  onDismiss,
}: InlineAlternativesPanelProps) {
  const [elapsed, setElapsed] = useState(0);
  const [focusedIdx, setFocusedIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Tick the elapsed counter while pending.
  useEffect(() => {
    if (state !== "pending") return;
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 100);
    return () => clearInterval(id);
  }, [state, startedAt]);

  // Keyboard handlers — Esc dismiss, Enter commit focused, ArrowUp/Down move focus.
  useEffect(() => {
    if (state !== "ready") return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const sib = siblings[focusedIdx];
        if (sib) onPick(sib.id);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIdx((i) => Math.min(siblings.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIdx((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [state, siblings, focusedIdx, onPick, onDismiss]);

  // Pending: just a spinner + countdown card.
  if (state === "pending") {
    const seconds = elapsed / 1000;
    const targetSeconds = 12; // empirical typical reroll-phrase wall time
    const ratio = Math.min(1, seconds / targetSeconds);
    return (
      <div
        ref={containerRef}
        className="absolute z-40 pointer-events-auto rounded-md border border-stone-700/60 bg-stone-900/85 backdrop-blur-sm px-4 py-3 shadow-xl"
        style={{ left: anchorX, top: anchorY, width }}
      >
        <div className="flex items-center gap-3">
          <Spinner />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-stone-500">
              generating alternatives
            </div>
            <div className="text-[13px] text-stone-300 truncate">
              for "<span className="text-stone-100">{selectedText.slice(0, 60)}{selectedText.length > 60 ? "…" : ""}</span>"
            </div>
          </div>
          <div className="text-[11px] tabular-nums text-stone-500 whitespace-nowrap">
            {seconds.toFixed(1)}s · ~{targetSeconds}s
          </div>
        </div>
        {/* Progress bar (heuristic, not actual API completion) */}
        <div className="mt-2 h-[2px] w-full bg-stone-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-violet-400/70 transition-all duration-200 ease-out"
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
        <div className="mt-2 text-[10px] text-stone-600">
          Esc to cancel
        </div>
      </div>
    );
  }

  if (state === "committing") {
    return (
      <div
        className="absolute z-40 pointer-events-none rounded-md border border-stone-700/60 bg-stone-900/80 px-4 py-2 shadow-xl"
        style={{ left: anchorX, top: anchorY, width }}
      >
        <div className="flex items-center gap-2 text-stone-400 text-[12px]">
          <Spinner small />
          committing…
        </div>
      </div>
    );
  }

  // Ready: list of alternatives. Each shows the diff of the selected phrase
  // against the alternative's substituted phrase, color-coded.
  return (
    <div
      ref={containerRef}
      className="absolute z-40 pointer-events-auto rounded-md border border-stone-700/60 bg-stone-900/90 backdrop-blur-sm shadow-xl"
      style={{ left: anchorX, top: anchorY, width }}
    >
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-stone-800">
        <div className="text-[11px] uppercase tracking-wider text-stone-500">
          {siblings.length} alternative{siblings.length === 1 ? "" : "s"} for "{selectedText.slice(0, 40)}{selectedText.length > 40 ? "…" : ""}"
        </div>
        <div className="text-[10px] text-stone-600">
          ↑↓ navigate · Enter pick · Esc dismiss
        </div>
      </div>
      <div className="divide-y divide-stone-800">
        {siblings.map((sib, i) => {
          const c = GHOST_COLORS[i % GHOST_COLORS.length];
          const diff = diffSpan(sib.content.split("\n")[0] || sib.content, sib.content.split("\n")[0] || sib.content);
          // For each sibling, show the *replacement phrase* prominently with surrounding context dimmed.
          const phraseDiff = inferPhraseDiff(siblings[0]?.content ?? "", sib.content, selectedText);
          const isFocused = i === focusedIdx;
          return (
            <button
              key={sib.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onPick(sib.id); }}
              onMouseEnter={() => setFocusedIdx(i)}
              className={`w-full text-left px-3 py-2 border-l-2 transition-colors ${c.border} ${
                isFocused ? "bg-stone-800/80" : "hover:bg-stone-800/50"
              }`}
            >
              <div className="text-[10px] tabular-nums text-stone-600 mb-0.5">
                option {i + 1}
              </div>
              <div className={`text-[13px] leading-snug ${c.text}`}>
                <span className="text-stone-500">…{phraseDiff.before}</span>
                <span className={`px-0.5 rounded ${isFocused ? "bg-stone-700" : ""} font-medium`}>
                  {phraseDiff.replacement || "(empty)"}
                </span>
                <span className="text-stone-500">{phraseDiff.after}…</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Cheap heuristic: look for selectedText in the original content, find what
// the sibling has in that same position. Falls back to whole-content diff.
function inferPhraseDiff(originalContent: string, siblingContent: string, selectedText: string): { before: string; replacement: string; after: string } {
  // Use the diff of original-vs-sibling around the selection.
  const idx = originalContent.indexOf(selectedText);
  if (idx === -1) {
    // Fallback: just show first 80 chars of sibling
    return { before: "", replacement: siblingContent.slice(0, 80), after: "" };
  }
  // Compute the prefix length they share
  let p = 0;
  while (p < originalContent.length && p < siblingContent.length && originalContent[p] === siblingContent[p]) p++;
  // Suffix length they share
  let s = 0;
  while (
    s < originalContent.length - p &&
    s < siblingContent.length - p &&
    originalContent[originalContent.length - 1 - s] === siblingContent[siblingContent.length - 1 - s]
  ) s++;
  const replacement = siblingContent.slice(p, siblingContent.length - s);
  // Show ~40 chars of context on either side
  const ctx = 36;
  const before = originalContent.slice(Math.max(0, p - ctx), p);
  const after = originalContent.slice(originalContent.length - s, Math.min(originalContent.length, originalContent.length - s + ctx));
  return { before, replacement, after };
}

function Spinner({ small = false }: { small?: boolean }) {
  const size = small ? 12 : 18;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" fill="none">
      <circle cx="12" cy="12" r="10" stroke="rgba(168,162,158,0.2)" strokeWidth="3" />
      <path d="M12 2 a10 10 0 0 1 10 10" stroke="rgba(196, 181, 253, 0.9)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
