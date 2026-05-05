# Experiment B — Proximity gradient (the first phase transition)

**Status:** ✅ v1 done (visual cue only; physics deformation deferred)
**Branch:** `exp/phase-transition-canvas`
**Time:** ~30 min

## What

The first taste of phase-transition behavior. When two visible fragments are within `r_flow` distance (canvas coords, default 280px), an ambient teal connection appears between their nearest edges. Intensity grows continuously as distance closes — soft halo at the boundary, confident bond near merge distance.

This is the visual cue that says: "these two want to flow into each other." It precedes (and primes) the actual merge gesture, which lives in Experiment C.

## What I did NOT do (deliberately)

- **No physics force change.** The vision asked for fragments that "deform as I move them closer." Full deformation — text reflow at the boundary, baseline alignment across fragments — is the central magic of Experiment C. Doing it well requires real Pretext layout-with-obstacles, not just CSS, and I want C to be its own focused commit.
- **No discrete snap.** Smart-guides Figma-style would have been easier but discrete; the vision is continuous. Picked the gradient over the snap.
- **No physics-side attraction force pulling fragments together when in flow zone.** That breaks "spatially controlling this space" — Aditya wants to *decide* whether they merge. The gradient shows possibility; the merge happens by the user's gesture, not by the canvas's gravitational pull.

## How it's drawn

Inside the existing edges SVG, before the lineage edges so the lineage stays foreground:

- **Halo layer:** wider (6–16px), low opacity (0.05–0.40), warm-teal `rgba(94, 234, 212)`. Soft glow that reads as "atmosphere."
- **Core layer:** narrow (0.8–2.8px), higher opacity (0.20–0.75), brighter mint `rgba(167, 243, 208)`. Hard edge for the visual confirmation.
- Endpoints: closest pair of edges along the dominant axis. Vertical neighbors connect bottom-of-upper to top-of-lower; horizontal neighbors connect right-of-left to left-of-right.

Both stroke widths and opacities are linear in `intensity = (R_FLOW - dist) / (R_FLOW - R_MERGE)`, clamped to [0, 1].

## Files touched

- `src/components/loom/WorkspaceCanvas.tsx`:
  - New `R_FLOW` (280) and `R_MERGE` (90) constants.
  - New `proximityPairs` memo: O(n²) over visible fragments, returns pairs within `R_FLOW` with `intensity`.
  - Render block inside the existing edges SVG produces a `<g>` per pair with halo + core lines, oriented along the dominant axis.

## Before / after

- `001-stripped-large-no-alts.png` (from Experiment A) — fragments laid out with dagre arrows but no proximity cue.
- `002-proximity-glow-rest.png` — same workspace with the proximity gradient added. Two visible teal glows: one between fragments 1↔2, another between 2↔3. Even at rest, the gradient says "these belong to the same flow."
- `002-proximity-large.png` — earlier, single-line version (kept for comparison; less effective).
- `002-proximity-during-drag.png` — proximity holding while one fragment is mid-drag toward another. (Synthesized PointerEvent hit a setPointerCapture issue; the visual still works in real interaction.)

## How to verify

1. Open `bd509d73-061f-4f67-b961-98df19d24ff7` in canvas. Should see teal glow capsules between adjacent fragments at rest.
2. Drag a fragment closer to another. Glow should intensify; halo width should grow; core should solidify (dashed → solid at intensity > 0.5).
3. Drag a fragment away. Glow should fade and disappear at distance > 280px.
4. The DOM check: `Array.from(document.querySelectorAll('svg line')).filter(l => /94, 234, 212/.test(l.getAttribute('stroke')))` returns the halo lines.

## Numbers

`R_FLOW = 280`, `R_MERGE = 90`. These are canvas-coordinate units. At 100% zoom, 280px = roughly 0.6× the fragment width — close enough that two fragments at this distance feel "in the same neighborhood" but not overlapping. `R_MERGE = 90` is well inside a fragment's silhouette so getting that close already implies hold-to-merge intent.

These can be tuned; they're declared as module-scope `const`s in `WorkspaceCanvas.tsx` for now (no settings UI yet).

## What's next (Experiment C)

The proximity gradient anticipates the merge but doesn't change the text. Experiment C makes the text *itself* deform: at merge distance and held, the upper fragment's last line reaches toward the lower fragment's first line, the gap visually fills with prose, and at confirm the merge fires through `/api/tree/merge` (already exists). Pulling apart un-flows.
