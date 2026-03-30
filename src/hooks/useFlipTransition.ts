"use client";

import { useRef, useCallback } from "react";
import { timedMeasure, recordMeasurement } from "@/lib/layout-perf";

/**
 * FLIP (First, Last, Invert, Play) transition hook.
 *
 * Handles smooth layout transitions between free-form canvas positions
 * and column layout, accounting for width changes that cause text reflow
 * and height changes.
 *
 * The key insight: when node width changes, text reflows and node height changes.
 * We need to measure destination heights BEFORE animating so we know exact
 * endpoint positions. FLIP does this via a hidden measurement pass.
 */

interface FlipRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface FlipState {
  rects: Record<string, FlipRect>;
}

export function useFlipTransition() {
  const firstState = useRef<FlipState | null>(null);

  /**
   * Step 1 (First): Snapshot current positions/dimensions of all nodes.
   * Call this BEFORE changing layout mode.
   */
  const snapshotFirst = useCallback((nodeIds: string[], containerEl: HTMLElement) => {
    const rects: Record<string, FlipRect> = {};

    timedMeasure("flip-snapshot", nodeIds.length, () => {
      for (const id of nodeIds) {
        const el = containerEl.querySelector(`[data-node-id="${id}"]`) as HTMLElement | null;
        if (el) {
          const r = el.getBoundingClientRect();
          rects[id] = { left: r.left, top: r.top, width: r.width, height: r.height };
        }
      }
    });

    firstState.current = { rects };
  }, []);

  /**
   * Step 2 (Last + Invert + Play): After layout change, measure new positions,
   * compute the inversion, and animate.
   *
   * @param nodeIds - IDs of nodes to animate
   * @param containerEl - the transform container
   * @param targetWidth - the destination node width (may differ from current)
   * @param onHeightsMeasured - callback with measured destination heights
   * @param duration - animation duration in ms
   *
   * Returns a promise that resolves when animation completes.
   */
  const animateFlip = useCallback(
    async (
      nodeIds: string[],
      containerEl: HTMLElement,
      targetWidth: number,
      onHeightsMeasured?: (heights: Record<string, number>) => void,
      duration: number = 400
    ): Promise<void> => {
      const first = firstState.current;
      if (!first) return;

      const transitionStart = performance.now();

      // --- Measure destination heights at target width ---
      // We temporarily set each node to target width, measure, then revert.
      // This is the "hidden measurement pass" that Pretext could eliminate.
      const destHeights: Record<string, number> = {};

      timedMeasure("measure-heights", nodeIds.length, () => {
        const elements: Array<{ el: HTMLElement; origWidth: string; origTransition: string }> = [];

        // Batch read: set all widths
        for (const id of nodeIds) {
          const el = containerEl.querySelector(`[data-node-id="${id}"]`) as HTMLElement | null;
          if (el) {
            elements.push({
              el,
              origWidth: el.style.width,
              origTransition: el.style.transition,
            });
            el.style.transition = "none";
            el.style.width = `${targetWidth}px`;
          }
        }

        // Force layout reflow (single forced reflow for all elements)
        void containerEl.offsetHeight;

        // Batch read: measure all heights
        for (const { el } of elements) {
          const id = el.dataset.nodeId!;
          destHeights[id] = el.getBoundingClientRect().height;
        }

        // Batch write: revert all widths
        for (const { el, origWidth, origTransition } of elements) {
          el.style.width = origWidth;
          el.style.transition = origTransition;
        }

        // Force reflow to apply revert
        void containerEl.offsetHeight;
      });

      if (onHeightsMeasured) {
        onHeightsMeasured(destHeights);
      }

      // --- Measure "Last" positions (after layout change applied by caller) ---
      const lastRects: Record<string, FlipRect> = {};

      timedMeasure("flip-snapshot", nodeIds.length, () => {
        for (const id of nodeIds) {
          const el = containerEl.querySelector(`[data-node-id="${id}"]`) as HTMLElement | null;
          if (el) {
            const r = el.getBoundingClientRect();
            lastRects[id] = { left: r.left, top: r.top, width: r.width, height: r.height };
          }
        }
      });

      // --- Invert + Play ---
      timedMeasure("flip-apply", nodeIds.length, () => {
        const animations: Animation[] = [];

        for (const id of nodeIds) {
          const el = containerEl.querySelector(`[data-node-id="${id}"]`) as HTMLElement | null;
          const firstRect = first.rects[id];
          const lastRect = lastRects[id];
          if (!el || !firstRect || !lastRect) continue;

          const dx = firstRect.left - lastRect.left;
          const dy = firstRect.top - lastRect.top;
          const sw = firstRect.width / lastRect.width;
          const sh = firstRect.height / lastRect.height;

          // Only animate if there's meaningful change
          if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sw - 1) < 0.01 && Math.abs(sh - 1) < 0.01) {
            continue;
          }

          const anim = el.animate(
            [
              {
                transform: `translate(${dx}px, ${dy}px) scale(${sw}, ${sh})`,
                transformOrigin: "top left",
              },
              {
                transform: "translate(0, 0) scale(1, 1)",
                transformOrigin: "top left",
              },
            ],
            {
              duration,
              easing: "cubic-bezier(0.2, 0, 0.2, 1)",
              fill: "none",
            }
          );
          animations.push(anim);
        }

        // No need to wait synchronously — animations fire on next frame
      });

      // Wait for animations to complete
      await new Promise<void>((resolve) => setTimeout(resolve, duration));

      // Record full transition time
      const totalMs = performance.now() - transitionStart;
      recordMeasurement({
        timestamp: Date.now(),
        operation: "full-transition",
        nodeCount: nodeIds.length,
        durationMs: totalMs,
      });

      firstState.current = null;
    },
    []
  );

  return { snapshotFirst, animateFlip };
}
