# Experiment A — Strip chrome + flow visual baseline

**Status:** ✅ Done
**Branch:** `exp/phase-transition-canvas`
**Time:** ~50 min
**Result:** Major visual win. The "ugly rectangular containers" critique is resolved.

## What

Three things, layered on top of Experiment 0:

1. **Strip the chrome.** Remove rectangle border, model badge, version pip, `pick`/`extend`/`stage`/`edit` buttons from default fragment render. Keep them, but hide until hover (positioned above the fragment as a popover, so they don't displace text).
2. **Provenance becomes a 2px left-edge stripe.** Emerald for human-typed, blue for ai-generated, violet for split, amber for imported, teal for derived, stone for system. Subtle saturation difference per AI model (warm-amber for Sonnet, cool-cyan for Haiku, etc.) on top of the stripe.
3. **Hide sibling alternatives on canvas per the vision.** Per the phase-transition design Aditya stated: "siblings are all hidden because in the canvas mode you're working with one single traversal of the tree." Unplaced fragments (alternative completions not picked) no longer render here — they live in tree view. Stats badge now shows "N alts hidden" so you know they're there.
4. **Height-aware dagre + physics.** The old layout treated every fragment as 80px tall, so multi-paragraph completions overlapped their neighbors. New `estimateFragmentHeight(content, semanticZoom)` derives a height from content length (capped at 640px). Dagre and physics both use it, plus the bbox calc that drives auto-fit.

## Files touched

- `src/components/loom/WorkspaceCanvas.tsx` — biggest changes:
  - `provenanceStripe(f)` and `modelTextColor(f)` helpers replace the old `provenanceColor` for the default render path.
  - `estimateFragmentHeight(content, sz)` height estimator.
  - `computeDagreLayout` signature changed from `(frags, edges, nodeWidth, nodeHeight)` to `(frags, edges, nodeWidth, heightFor)` so per-fragment heights can be passed.
  - `physicsNodeSize` looks up height per fragment.
  - `contentBbox` uses height-for in its accumulation.
  - FULL-level render: bare `pl-3 pr-3 py-2` text on transparent bg, left-stripe via outer div className, hover toolbar `absolute -top-6` above the text. `text-wrap: pretty` on the content div.
  - SUMMARY-level render: same provenance-stripe treatment; label dim and shows on hover.
  - COMPACT-level render: same.
  - `allVisible` no longer includes `unplacedFragments`.
  - Stats badge now reads "N active · N staged · N alts hidden · N gen".
  - Stage column iterates only `stageFragments`.

## Before / after

- `001-stripped-large-no-alts.png` — **the headline result.** Three active fragments on the bd509d73 workspace at 158% zoom. Emerald stripe on the human prompt, blue stripes on the two AI completions. No borders, no badges, no buttons. Just text floating on stone-950 with faint lineage arrows between fragments. "37 alts hidden" in the corner stats so you know they exist but aren't competing for attention.
- `001-stripped-after-relayout.png` — small workspace (4 frags) at 168%. Two fragments laid out side-by-side, no overlap thanks to height-aware dagre.
- `001-stripped-fitted.png` — full bd509d73 workspace at compact (21%) semantic zoom. The structure of the 48-fragment tree is visible at a glance; provenance stripes are still legible at this scale.
- `001-stripped-large-relayout.png` — same workspace at summary (51%) before alts were hidden. Useful to compare what was on canvas before this experiment vs after.

## What Aditya should look for when reviewing

- Open `bd509d73-061f-4f67-b961-98df19d24ff7` in canvas view.
- Hit `re-layout` if positions look stale.
- Read down the active sequence — should feel like a quiet column of prose, color-stripe at the left edge.
- Hover any fragment — toolbar should pop up above with `extend`, `stage`, sibling indicator, etc.
- Open tree view (header) — alternatives should still be visible there.
- The "37 alts hidden" hint in stats explains where they went.

## What's still wrong / not yet done

- **Auto-fit isn't perfectly tight.** Sometimes content runs slightly off the right edge at the chosen zoom (visible in `001-stripped-after-relayout.png`). The fitToBox math is correct in principle; the issue is fitToBox uses `nodeWidth` for max-x but content can extend slightly past it via margins. A 5–10% extra padding would mask it; doing that as a follow-on.
- **Real Pretext lib not used.** Currently relying on `text-wrap: pretty` (CSS-level Knuth-Plass-style line balancing, supported in Chrome 117+, Firefox 121+, Safari 17.4+). For older browsers it degrades to default `whitespace-pre-wrap`. If Aditya wants exact control over break decisions (e.g., for the phase-transition flow in Experiment C), the `@chenglou/pretext` library is already a dep and ready to use. Holding back until Experiment C since the simpler CSS path looks fine in the screenshots.
- **The hover toolbar uses `group-hover:opacity-100`.** Works for mouse, but trackpad or touch users might have trouble revealing it. Will revisit if it bites in practice.
- **Drag/select interaction unchanged.** The vision said "grab a whole fragment by clicking text" but the existing handler still routes click-on-text → text selection. That's a deliberate carve-out for Experiment A; the click-vs-drag logic belongs in Experiment B/C where it composes with the proximity-merge gesture.

## What this experiment proves

The visual ugliness was almost entirely chrome density + height-blind layout, not the rectangle primitive itself. Strip the chrome and pass real heights to dagre and the canvas immediately reads as a wizard's table — quiet, prose-centered, just enough visual structure to navigate without competing with the writing.

The phase-transition deformation (Experiments B & C) builds on this baseline. Without this baseline, those experiments would feel like jewelry on a clown.
