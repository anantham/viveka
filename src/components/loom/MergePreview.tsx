"use client";

import { useEffect, useRef, useState } from "react";
import type { MergeType } from "./MergeSpinner";

interface MergePreviewProps {
  /** Top-left position in canvas coords. */
  x: number;
  y: number;
  /** Width to lay text within. */
  width: number;
  /** Source fragment content (the dragged one). */
  sourceContent: string;
  /** Target fragment content (the receiving one). */
  targetContent: string;
  /** Merge variant — drives ordering hint and color. */
  mergeType: MergeType;
  /** When the merge candidate started — drives the fade-in animation. */
  startedAt: number;
  /** Total hold duration before merge confirms (ms). */
  durationMs: number;
  /** True once the merge has been confirmed and is firing. */
  confirmed: boolean;
}

const MERGE_RGB: Record<MergeType, string> = {
  append: "59, 130, 246",
  prepend: "245, 158, 11",
  interleave: "139, 92, 246",
  summarize: "20, 184, 166",
};

// Local approximation of the merged content shown during the hold.
// Real /api/tree/merge runs Claude with light-edit instructions; this
// preview is the visual placeholder that says "they're flowing into
// one paragraph." Order tracks the merge variant.
function previewContent(
  sourceContent: string,
  targetContent: string,
  mergeType: MergeType
): string {
  switch (mergeType) {
    case "append":
      return `${targetContent}\n\n${sourceContent}`;
    case "prepend":
      return `${sourceContent}\n\n${targetContent}`;
    case "interleave": {
      // Best-effort interleave: alternate sentence-ish chunks.
      const a = sourceContent.split(/(?<=[.!?])\s+/).filter(Boolean);
      const b = targetContent.split(/(?<=[.!?])\s+/).filter(Boolean);
      const out: string[] = [];
      const max = Math.max(a.length, b.length);
      for (let i = 0; i < max; i++) {
        if (i < a.length) out.push(a[i]);
        if (i < b.length) out.push(b[i]);
      }
      return out.join(" ");
    }
    case "summarize":
      // No summary available locally — show both contents under a marker so
      // the writer sees both source materials while waiting for the actual
      // distilled merge to be generated server-side.
      return `[distilling…]\n\n${sourceContent}\n\n${targetContent}`;
  }
}

export default function MergePreview({
  x, y, width,
  sourceContent, targetContent,
  mergeType, startedAt, durationMs, confirmed,
}: MergePreviewProps) {
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

  // Cache the preview content per source/target/mergeType combination so it
  // doesn't recompute every animation frame.
  const previewRef = useRef<{ key: string; text: string } | null>(null);
  const key = `${sourceContent.length}-${targetContent.length}-${mergeType}`;
  let text = previewRef.current?.text;
  if (!previewRef.current || previewRef.current.key !== key) {
    text = previewContent(sourceContent, targetContent, mergeType);
    previewRef.current = { key, text };
  }

  const rgb = MERGE_RGB[mergeType];
  // Opacity ramps gently: barely-there at start, dominant near the merge
  // commit, solid once confirmed. Originals fade complementarily (handled
  // in WorkspaceCanvas's renderFragment).
  const opacity = confirmed ? 1 : 0.05 + progress * 0.85;
  const stripeOpacity = confirmed ? 0.9 : 0.2 + progress * 0.6;

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: x,
        top: y,
        width,
        zIndex: 40,
      }}
    >
      <div
        className="pl-3 pr-3 py-2 text-[15px] leading-[1.55] whitespace-pre-wrap rounded-r"
        style={{
          opacity,
          color: confirmed
            ? "rgba(245, 245, 244, 0.98)"
            : `rgba(245, 245, 244, ${0.6 + 0.35 * progress})`,
          borderLeft: `2px solid rgba(${rgb}, ${stripeOpacity})`,
          background: progress > 0.4 || confirmed
            ? `linear-gradient(90deg, rgba(${rgb}, ${0.10 * progress}), rgba(${rgb}, 0))`
            : "transparent",
          textWrap: "pretty",
          transition: "background 200ms ease-out",
        } as React.CSSProperties}
      >
        {text}
      </div>
    </div>
  );
}
