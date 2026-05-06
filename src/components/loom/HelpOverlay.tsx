"use client";

import { useEffect } from "react";

/**
 * HelpOverlay — minimal cheatsheet for the canvas's invisible gesture
 * vocabulary. Mounted from a `?` button in the top header. Designed to
 * grow: each section is a heading + a flat list of [key, description]
 * pairs; add new rows or sections without touching layout.
 */

interface Section {
  heading: string;
  rows: { key: React.ReactNode; description: string }[];
}

const KBD =
  "px-1.5 py-0.5 rounded border border-stone-700 bg-stone-900 font-mono text-[10px] text-stone-300";

function MergeArrow({ dir, color }: { dir: "→" | "←" | "↑" | "↓"; color: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-mono text-stone-300">{dir}</span>
      <span
        className="inline-block w-2 h-2 rounded-full"
        style={{ backgroundColor: color }}
      />
    </span>
  );
}

const SECTIONS: Section[] = [
  {
    heading: "Drag-to-merge",
    rows: [
      {
        key: <span className="text-stone-400">drag fragment near another, hold ~2s</span>,
        description: "Two fragments fuse into one (LLM merges them).",
      },
      {
        key: <MergeArrow dir="→" color="rgb(96, 165, 250)" />,
        description: "Append — A then B, lightly stitched.",
      },
      {
        key: <MergeArrow dir="←" color="rgb(245, 158, 11)" />,
        description: "Prepend — A before B, lightly stitched.",
      },
      {
        key: <MergeArrow dir="↑" color="rgb(167, 139, 250)" />,
        description: "Interleave — sentences from both, woven.",
      },
      {
        key: <MergeArrow dir="↓" color="rgb(45, 212, 191)" />,
        description: "Summarize — distill both into shorter synthesis.",
      },
      {
        key: <span className="text-stone-400">unmerge badge</span>,
        description: "Auto-shows for 30s after merge; permanent on hover.",
      },
    ],
  },
  {
    heading: "Edit & vary",
    rows: [
      { key: <span className={KBD}>dbl-click</span>, description: "Edit fragment in place." },
      { key: <span className={KBD}>⌘ ↵</span>, description: "Save edit." },
      {
        key: <span className="text-stone-400">select text in fragment</span>,
        description: "Reroll just the selected phrase (5 alternatives).",
      },
      { key: <span className={KBD}>↑ ↓</span>, description: "Cycle through reroll alternatives." },
      { key: <span className={KBD}>↵</span>, description: "Commit current alternative." },
      { key: <span className={KBD}>esc</span>, description: "Dismiss reroll preview." },
    ],
  },
  {
    heading: "Pan & zoom",
    rows: [
      {
        key: <span className="text-stone-400">wheel / trackpad</span>,
        description: "Pan.",
      },
      {
        key: (
          <span>
            <span className={KBD}>⌘</span>/<span className={KBD}>ctrl</span> + wheel
          </span>
        ),
        description: "Zoom toward cursor.",
      },
      {
        key: <span className="text-stone-400">click-drag background</span>,
        description: "Pan.",
      },
      {
        key: <span className="text-stone-400">middle-click drag</span>,
        description: "Pan (works anywhere).",
      },
    ],
  },
  {
    heading: "Cursor tools",
    rows: [
      { key: <span className={KBD}>1</span>, description: "Select." },
      { key: <span className={KBD}>2</span>, description: "Tangent (branch)." },
      { key: <span className={KBD}>3</span>, description: "Grab (pan-by-default)." },
    ],
  },
];

export default function HelpOverlay({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-stone-950 border border-stone-700 rounded-md p-6 max-w-2xl w-[90vw] max-h-[85vh] overflow-y-auto font-mono text-xs text-stone-300"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between mb-4 pb-3 border-b border-stone-800">
          <h2 className="text-sm tracking-wide text-stone-200">canvas gestures</h2>
          <button
            onClick={onClose}
            className="text-stone-500 hover:text-stone-300 text-base leading-none"
            aria-label="close"
          >
            ×
          </button>
        </div>

        <div className="space-y-5">
          {SECTIONS.map((section) => (
            <div key={section.heading}>
              <h3 className="text-[11px] uppercase tracking-wider text-stone-500 mb-2">
                {section.heading}
              </h3>
              <div className="space-y-1.5">
                {section.rows.map((row, i) => (
                  <div key={i} className="flex items-baseline gap-3">
                    <div className="min-w-[140px] text-stone-300">{row.key}</div>
                    <div className="text-stone-500 flex-1">{row.description}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 pt-3 border-t border-stone-800 text-[10px] text-stone-600">
          press <span className={KBD}>esc</span> to close
        </div>
      </div>
    </div>
  );
}
