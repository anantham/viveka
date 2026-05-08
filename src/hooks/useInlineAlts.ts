"use client";

import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { Workspace } from "@/lib/workspace";

/**
 * Inline-alts state — used by both "replace" (in-place phrase reroll
 * preview) and "extend" (ghost-continuation preview).
 *
 * - **replace:** writer selects text + clicks replace. Source fragment
 *   renders with prefix + highlighted-alternative + suffix. Commit
 *   edits the source fragment's content in place; no new nodes.
 * - **extend:** writer clicks extend on hover toolbar. Source fragment
 *   renders normally; a ghost continuation is appended after it.
 *   Commit appends exactly ONE new child fragment with the chosen
 *   content; the other alternatives never persist.
 */
export type InlineAltsState =
  | {
      mode: "replace";
      sourceFragmentId: string;
      selectedText: string;
      charStart: number;
      charEnd: number;
      state: "pending" | "preview" | "committing";
      alternatives: string[];
      currentIdx: number;
      startedAt: number;
      /** Spread cache: alternative index → LLM-edited fragment content
       *  (with same-connotation occurrences swapped across the whole
       *  fragment). Filled lazily as the writer lands on each
       *  alternative. When present for the current index, the preview
       *  shows the spread version and commit uses it instead of the
       *  literal single-range swap. */
      spreadCache: Record<number, string>;
      spreadLoading: boolean;
    }
  | {
      mode: "extend";
      sourceFragmentId: string;
      state: "pending" | "preview" | "committing";
      alternatives: string[];
      currentIdx: number;
      startedAt: number;
    };

/**
 * useInlineAlts — owns the side effects of the inline-alternatives
 * preview lifecycle. State stays in the caller (callers also seed
 * the state from the selection-toolbar / extend-button handlers).
 *
 * Two effects:
 *
 *   1. Keyboard shortcuts during preview — arrows cycle, Enter commits
 *      per-mode, Esc dismisses. For replace mode, commit prefers the
 *      spread-cached LLM-aware edit if present (same-connotation
 *      swaps across the whole fragment) over the literal single-range
 *      swap.
 *
 *   2. Spread-swap fire — when the writer lands on an alternative in
 *      replace mode, fire /api/tree/swap-phrase debounced 350ms.
 *      Result cached per-alternative so cycling back is instant. The
 *      preview renderer prefers the cached spread when present.
 */
export function useInlineAlts(args: {
  ws: Workspace;
  inlineAlts: InlineAltsState | null;
  setInlineAlts: Dispatch<SetStateAction<InlineAltsState | null>>;
  onCommitPhraseEdit?: (fragmentId: string, content: string) => void | Promise<void>;
  onCommitExtend?: (fragmentId: string, content: string) => void | Promise<void>;
}): void {
  const { ws, inlineAlts, setInlineAlts, onCommitPhraseEdit, onCommitExtend } = args;

  useEffect(() => {
    if (!inlineAlts || inlineAlts.state !== "preview") return;
    const handler = (e: KeyboardEvent) => {
      const N = inlineAlts.alternatives.length;
      if (N === 0) return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
        e.preventDefault();
        setInlineAlts((prev) =>
          prev ? { ...prev, currentIdx: (prev.currentIdx + 1) % N } : prev,
        );
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
        e.preventDefault();
        setInlineAlts((prev) =>
          prev ? { ...prev, currentIdx: (prev.currentIdx - 1 + N) % N } : prev,
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        const ia = inlineAlts;
        const alt = ia.alternatives[ia.currentIdx];
        if (!alt) return;
        if (ia.mode === "replace") {
          const frag = ws.fragments[ia.sourceFragmentId];
          if (!frag || !onCommitPhraseEdit) return;
          const spread = ia.spreadCache[ia.currentIdx];
          const newContent =
            spread ??
            frag.content.slice(0, ia.charStart) + alt + frag.content.slice(ia.charEnd);
          setInlineAlts((prev) => (prev ? { ...prev, state: "committing" } : prev));
          Promise.resolve(onCommitPhraseEdit(ia.sourceFragmentId, newContent)).finally(() => {
            setInlineAlts(null);
          });
        } else {
          if (!onCommitExtend) return;
          setInlineAlts((prev) => (prev ? { ...prev, state: "committing" } : prev));
          Promise.resolve(onCommitExtend(ia.sourceFragmentId, alt)).finally(() => {
            setInlineAlts(null);
          });
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        setInlineAlts(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [inlineAlts, onCommitPhraseEdit, onCommitExtend, ws.fragments, setInlineAlts]);

  useEffect(() => {
    if (!inlineAlts || inlineAlts.mode !== "replace" || inlineAlts.state !== "preview") return;
    const ia = inlineAlts;
    const alt = ia.alternatives[ia.currentIdx];
    if (!alt) return;
    if (ia.spreadCache[ia.currentIdx]) return;

    const sourceId = ia.sourceFragmentId;
    const idxAtFire = ia.currentIdx;
    const timer = setTimeout(async () => {
      setInlineAlts((prev) =>
        prev && prev.mode === "replace" ? { ...prev, spreadLoading: true } : prev,
      );
      try {
        const res = await fetch("/api/tree/swap-phrase", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            treeId: ws.id,
            fragmentId: sourceId,
            originalPhrase: ia.selectedText,
            alternativePhrase: alt,
          }),
        });
        const data = await res.json();
        if (!data.editedContent) return;
        setInlineAlts((prev) => {
          if (!prev || prev.mode !== "replace" || prev.sourceFragmentId !== sourceId) return prev;
          return {
            ...prev,
            spreadLoading: false,
            spreadCache: { ...prev.spreadCache, [idxAtFire]: data.editedContent },
          };
        });
      } catch (err) {
        console.warn("[swap-phrase] spread call failed:", err);
        setInlineAlts((prev) =>
          prev && prev.mode === "replace" ? { ...prev, spreadLoading: false } : prev,
        );
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [inlineAlts, ws.id, setInlineAlts]);
}
