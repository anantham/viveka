# Phase-Transition Canvas — Progress Journal

Chronological log of the autonomous redesign run. Most recent entry at the bottom.

---

## 2026-05-04 ~20:30 — Setup

- Read VISION.md back to confirm I understood the phase-transition design.
- Checkpointed all in-flight work to `wip/canvas-handover-2026-05-04` (commit `109e18b`). Includes WordLevelContent.tsx, page.tsx home cleanup, physics tuning, dump interface fixes.
- Branched `exp/phase-transition-canvas` from there.
- `npm test` baseline: 54/54 passing.
- Dev server up on :3000.
- Playwright + chrome-devtools MCPs both available.
- Observed actual overlap on `/loom/bd509d73-061f-4f67-b961-98df19d24ff7` — three SONNET cards stacking with IoU 0.5–0.95. Confirms vision.md diagnosis.

## 2026-05-04 ~20:40 — Experiment 0 (mechanical) ✅

Three independent fixes landed in commit `cc8eacc`:

- Auto-fit viewport on workspace open via new `fitToBox` in `usePanZoom`.
- `[fit]` and `[re-layout]` buttons in canvas top-right toolbar.
- `replace?: boolean` flag on `/api/tree/canvas-positions` so re-layout actually wipes positions.
- Dead `else` branch in `src/app/page.tsx` removed.

Verified visually with playwright: `before-overlap.png` (three SONNETs stacking) → `after-relayout.png` (clean dagre tree at 42%).

54/54 tests still pass.

## 2026-05-04 ~20:55 — Experiment A (strip & flow) ✅

The visual baseline. Layered in commit `<next>`:

- Provenance encoded as a 2px left-edge stripe (`provenanceStripe`), not as border + bg. Per-AI-model warmth tinting on text color (`modelTextColor`).
- Default fragment render is bare text on transparent bg with the stripe; chrome (model badge, action buttons, sibling indicator, sequence number) lives in a `group-hover` popover above the fragment so it never displaces the text.
- `text-wrap: pretty` on the content div for browser-level line balancing. Real Pretext library held back until Experiment C since CSS already looks right.
- Height-aware dagre: new `estimateFragmentHeight(content, semanticZoom)` derives height from content length (capped at 640px). `computeDagreLayout` signature changed from `nodeHeight: number` to `heightFor: (f: Fragment) => number`. `physicsNodeSize` and the bbox calc both use it.
- `allVisible` no longer includes `unplacedFragments` per the vision ("siblings are all hidden because in canvas mode you're working with one single traversal"). Stats badge now shows "N active · N staged · N alts hidden" so the count is still honest.
- Same strip-and-flow treatment applied to summary and compact semantic zoom levels for consistency.

Verified visually with playwright on the 48-fragment workspace `bd509d73` and on the small 4-fragment `07daa707`. `001-stripped-large-no-alts.png` is the headline — three active fragments at 158% zoom, no borders, color-stripes, prose-centered.

54/54 tests still pass.

## What's left for the autonomous run

- **Experiment B — Column-snap.** When two fragments come within `r_flow`, share a layout context and snap into the same column. First taste of "they want to flow together."
- **Experiment C — Merge-on-hold with flow gradient.** Generalize the existing collision-merge from binary snap to a continuous deformation. The central magic of the design.
- **Experiment D — Inline alternatives during reroll/extend.** Ephemeral colored ghost text rendered inline. The "local zoomed-in tree" view that summons siblings only during operations.
- **SYNTHESIS.md** — final summary with screenshots and recommendations.

If time runs out, Experiments B and C are the highest-value remaining work. D is nice-to-have for a fuller demo.
