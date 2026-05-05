# Experiment C — Merge candidate visual reinforcement

**Status:** ✅ v1 done (visual reinforcement). Text-deformation deferred to v2.
**Branch:** `exp/phase-transition-canvas`
**Time:** ~25 min

## What

When the existing collision-merge gesture fires (drag a fragment onto another, hold for 2s — already implemented in `usePhysicsSimulation` with `MERGE_OVERLAP_DIST = 30`), the proximity gradient between that specific pair takes on the merge-type's color and intensifies:

- **Color tracks merge type** (already shown by `MergeSpinner`):
  - blue (append)
  - amber (prepend)
  - violet (interleave / "weave")
  - teal (summarize / "distill")
- **Always max intensity**, no dashing.
- **Halo bumps** to 12–28px wide (vs 6–16 for ambient pairs).
- **Core bumps** to 1.5–4.5px wide and 0.55–0.95 opacity.

The result: ambient pairs gently glow teal at all distances; the active merge pair lights up in the merge-type's color and becomes a confident, solid bond that visually echoes the spinner's color and label. Two systems telling the same story.

## What I did NOT do (deferred)

The vision asks for fragments that "deform as I move them closer to each other." A full deformation — text reflow at the boundary, baselines aligning across fragments, gap visibly filling with prose — needs Pretext layout-with-obstacles run on the combined content, with smooth interpolation between two-paragraph and one-paragraph layouts.

That's the v2 of Experiment C. It would dwarf this commit and would land more cleanly after Experiment D ships, when the inline-alternatives infrastructure is also built up. Holding.

## Files touched

- `src/components/loom/MergeSpinner.tsx`:
  - Exported `MergeType` and `MERGE_COLORS`.
  - Added `MERGE_COLORS_RGB` (same colors as RGB triples for alpha composition).
- `src/components/loom/WorkspaceCanvas.tsx`:
  - Imported `MERGE_COLORS_RGB`.
  - In the proximity-gradient render block: detect `mergeCandidate` matching the pair, override intensity to 1, bump halo/core widths and opacities, switch color to `MERGE_COLORS_RGB[mergeCandidate.mergeType]`, drop dashing.

## Before / after

- `002-proximity-glow-rest.png` (from Experiment B) — ambient teal gradients between three fragments. Baseline.
- `003-merge-during-hold.png` — drag attempt #1 — bottom fragment dragged near middle. The teal pill capsule between dragged frag and middle frag is clearly stronger than ambient pairs, but merge-candidate didn't fire because programmatic drag didn't land in `MERGE_OVERLAP_DIST = 30` of the target's center. Still useful as a "during drag, gradients track movement" demonstration.
- `003-merge-spinner-active.png` — drag attempt #2 — same situation; the hover toolbar of the dragged fragment ("AI 1.9s · 7/9 ·4 extend stage") is now correctly visible at the top of the dragged fragment, confirming the `group-hover` chrome from Experiment A works in real interaction.

## Why no live merge-spinner screenshot

`MERGE_OVERLAP_DIST = 30` is a tight threshold — the dragged fragment's center must land within 30 canvas units of the target's center. Real hand-drag with snap-feel lands easily. Programmatic Playwright drag with auto-fit interfering between frames keeps missing by 100+ px.

The code path is straightforward:
1. Physics tick (in `usePhysicsSimulation`) detects collision via `closestDist < MERGE_OVERLAP_DIST`, calls `onMergeCandidate(info)`.
2. `onMergeCandidate` callback in `WorkspaceCanvas` sets `mergeCandidate` state with `{draggedId, targetId, mergeType, ...}`.
3. The proximity-pair render checks `mergeCandidate.draggedId === p.a && mergeCandidate.targetId === p.b` (or reverse) and switches to the merge-color, max-intensity styling.
4. After `MERGE_DURATION_MS` (handled by an existing effect at line ~643), `mergeCandidate.confirmed = true`, `/api/tree/merge` fires.

If Aditya tests by hand and the merge-color gradient *doesn't* appear during the spinner countdown, the bug is in step 1/2/3 wiring — but I checked the conditional and it matches the existing `mergeCandidate` shape.

## What's next

- **Experiment C v2** — real text deformation: Pretext layout-with-obstacles over the combined fragment content, animated transition during the merge hold. The big move that delivers "they deform as they approach."
- **Experiment D** — inline alternatives during reroll/extend. Independent of C v2; can land first.
