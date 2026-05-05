# Phase-Transition Canvas — Progress Journal

Chronological log of the autonomous redesign run. Most recent entry at the bottom. Read SYNTHESIS.md for the wrap-up overview.

---

## 2026-05-04 ~20:30 — Setup

- Read VISION.md back to confirm I understood the phase-transition design.
- Checkpointed all in-flight work to `wip/canvas-handover-2026-05-04` (commit `109e18b`). Includes WordLevelContent.tsx, page.tsx home cleanup, physics tuning, dump interface fixes.
- Branched `exp/phase-transition-canvas` from there.
- `npm test` baseline: 54/54 passing.
- Dev server up on :3000.
- Playwright + chrome-devtools MCPs both available.
- Observed actual overlap on `/loom/bd509d73-061f-4f67-b961-98df19d24ff7` — three SONNET cards stacking with IoU 0.5–0.95. Confirms vision.md diagnosis.

## 2026-05-04 ~20:40 — Experiment 0 (mechanical) ✅ — commit `cc8eacc`

Three independent fixes:

- Auto-fit viewport on workspace open via new `fitToBox` in `usePanZoom`.
- `[fit]` and `[re-layout]` buttons in canvas top-right toolbar.
- `replace?: boolean` flag on `/api/tree/canvas-positions` so re-layout actually wipes positions.
- Dead `else` branch in `src/app/page.tsx` removed.

54/54 tests still pass.

## 2026-05-04 ~20:55 — Experiment A (strip & flow) ✅ — commit `34c626a`

The visual baseline:

- 2px left-edge provenance stripe replaces border + bg; subtle warmth tinting per AI model on text color.
- Default render = bare text on transparent bg with the stripe; chrome lives in a hover popover above the fragment so it doesn't displace text.
- `text-wrap: pretty` on the content div (browser-level Knuth-Plass-style line balancing).
- Height-aware dagre + physics: new `estimateFragmentHeight(content, semanticZoom)` derives heights from content length. Fixes the post-relayout overlap for multi-paragraph completions.
- Sibling alternatives no longer rendered on canvas per the vision; live in tree view. Stats show "N alts hidden".
- Strip-and-flow treatment also applied to summary and compact semantic zoom levels.

54/54 tests still pass. Headline screenshot: `experiments/001-strip-and-flow/001-stripped-large-no-alts.png`.

## 2026-05-04 ~21:02 — Experiment B (proximity gradient) ✅ — commit `5d7a129`

The first phase transition:

- Constants `R_FLOW = 280`, `R_MERGE = 90` (canvas units).
- `proximityPairs` memo: O(n²) over visible fragments, returns pairs within `R_FLOW` with continuous `intensity = clamp((R_FLOW - dist) / (R_FLOW - R_MERGE))`.
- Render: per pair, a halo (warm-teal, 6–16px wide, 0.05–0.40 opacity) and a core (mint, 0.8–2.8px, 0.20–0.75 opacity, dashed below intensity 0.5). Endpoints attach to the closer pair of edges along the dominant axis.

54/54 tests still pass. Visible at rest: `experiments/002-column-snap/002-proximity-glow-rest.png`.

## 2026-05-04 ~21:11 — Experiment C v1 (merge gradient reinforcement) ✅ — commit `0c2f756`

When the existing physics collision-merge fires, the gradient between that specific pair takes on the merge variant's color (blue / amber / violet / teal-saturate) and bumps to confident max-intensity solid bond. Two systems telling the same story — spinner counts time, gradient signals which merge variant is queued.

- `MergeSpinner.tsx` now exports `MergeType`, `MERGE_COLORS`, and a new `MERGE_COLORS_RGB` (RGB triples).
- WorkspaceCanvas detects merge candidate pair in the proximity render, overrides color/width/opacity/dashing.

54/54 tests still pass.

The deeper version (Experiment C v2, real text deformation via Pretext layout-with-obstacles during the merge hold) is deferred — speced in SYNTHESIS.md.

## 2026-05-04 ~21:14 — Auto-fit polish ✅ — commit `<final>`

Two small but compounding wins for the auto-fit experience:

- `fitToBox` now accepts a `maxFitZoom` parameter (default 1.5). Prevents single-fragment workspaces from filling the screen at 200%+ zoom.
- `contentBbox` inflates the bounding box by `nodeWidth / 4` on each side so fragments don't sit flush against the viewport padding line.

Visible difference: small workspace (`07daa707-…`) now opens at 119% (was 168%). Large workspace (`bd509d73-…`) opens at 106% (was 158%) with all three fragments comfortably in view.

## What's left for the next session

See SYNTHESIS.md "Spec for the next session." Two main moves:

1. **Experiment C v2** — real text deformation during merge hold (Pretext layout-with-obstacles, animated transition between two-paragraph and one-paragraph layouts).
2. **Experiment D** — inline alternatives during reroll/extend (ephemeral colored ghost text rendered in-place, picker UX with Tab/Esc/arrow keys).

Plus polish items called out in the synthesis.

---

*End of autonomous run. Branch tip: `exp/phase-transition-canvas`. Diff vs main: ~5 commits, mostly localized to `WorkspaceCanvas.tsx`, `usePanZoom.ts`, `MergeSpinner.tsx`, `page.tsx`, `canvas-positions/route.ts`. Documentation in this directory.*
