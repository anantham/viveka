# Experiment 0 — Mechanical fixes

**Status:** ✅ Done
**Branch:** `exp/phase-transition-canvas`
**Time:** ~30 min

## What

Three independent fixes that should land regardless of which redesign wins:

1. **Auto-fit viewport on canvas open.** Compute bbox over all visible fragments, pan/zoom to fit with 8% padding. Fires once per workspace id.
2. **Re-layout gesture.** Top-right `[re-layout]` button clears `ws.canvasPositions`, clears local `manualPositions`, calls `onRefresh`. Dagre + physics re-seed from scratch. Auto-fit also fires on the reseeded layout.
3. **Fix dead `else` branch in `src/app/page.tsx`.** Referenced `tree` outside its scope. Unreachable since `interfaceMode` is now only `"loom" | "dump"`, but TS smell.

## Files touched

- `src/hooks/usePanZoom.ts` — added `fitToBox(bbox, viewport, paddingFraction)`.
- `src/components/loom/WorkspaceCanvas.tsx` — added `contentBbox` memo, `fitNow` / `relayoutNow` callbacks, auto-fit effect (one-shot per workspace id), `[fit]` and `[re-layout]` buttons in top-right toolbar.
- `src/app/api/tree/canvas-positions/route.ts` — added `replace?: boolean` flag so `relayoutNow` can wipe positions instead of merge-with-empty.
- `src/app/page.tsx` — collapsed the dead `else` branch.

## Before / after

- `before-overlap.png` — what the canvas looked like at session start. Three SONNET fragments stacking with IoU 0.5–0.95.
- `after-autofit.png` — auto-fit fires on canvas open, content centered at 21% zoom (compact semantic level), whole 48-fragment workspace visible.
- `after-relayout.png` — re-layout reseeds positions, clean dagre tree at 42% zoom. The 7 branches are now visible as a coherent topology instead of an overlap pile.

## What's still wrong

This experiment **doesn't address the visual ugliness Aditya flagged**. The cards still have:
- Hard rectangle borders
- `SONNET 5.6S`, version pips, `pick`/`extend`/`edit`/`stage` chrome
- `whitespace-pre-wrap` rendering (no pretext, no graceful line breaks)

Re-layout fixes overlap but the "ugly rectangular containers" critique stands. Experiment A is the next step.

## Trade-offs

- Auto-fit only fires once per workspace open. If the user already panned and the workspace updates dramatically (e.g., big generation), they don't get re-fit. Acceptable: respects user intent. Manual `[fit]` is always available.
- Re-layout is destructive — it wipes saved canvasPositions. There's no undo. Acceptable: physics will save fresh positions on next stabilize. If the user wants their old layout back, they need to manually re-arrange. The button label and amber hover hint at the destructive nature.
- The `replace: true` flag on `/api/tree/canvas-positions` is additive — existing callers (the physics onStabilize hook) still get merge behavior. No migration needed.
