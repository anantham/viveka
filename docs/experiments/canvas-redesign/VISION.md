# Phase-Transition Canvas — vision capture

Captured 2026-05-04 from Aditya. This is the design anchor for the autonomous redesign run on branch `exp/phase-transition-canvas`. Source: voice-quality message + earlier conversation. Treat this as ground truth for design choices below; the synthesis at the end of the run reports back what was built and what was deferred.

---

## The frame

Viveka is **an exoskeleton for writing**, not a chat tool, not even a workspace. The tool wraps the writer and amplifies their motion. Operations should feel like extensions of the writer's hand — flexing a muscle — not commands issued to a chatbot.

This frame demotes everything that competes with the writing: chrome, badges, action bars, mode-switchers. The text is the body. Everything else is silent until summoned.

## The canvas as phase-transition surface

The central insight: **distance encodes intent**.

- **Far apart** → fragments are paragraph-shaped chunks of bare text (no border, no chrome). Each is independently readable.
- **Closing distance** → fragments begin to deform. Pretext layout treats them as approaching the same flow context. Text wraps differently, baselines align, the visual gap narrows.
- **Within merge zone for hold-time** → they merge into one continuous prose. Fragment boundary dissolves.
- **Pulling apart** (reverse gesture) → merged prose un-flows back into chunks. Reversible.

So the spatial layout *is* the gesture. The writer arranges; the surface responds.

This generalizes the existing collision-merge (drag-onto-target-for-2s) from a binary snap into a continuous gradient. The collision-merge code in `usePhysicsSimulation` and the `/api/tree/merge` endpoint are the seed.

## Selection model

Two modes selected by what the writer is doing:

- **No highlight + click-drag on fragment** → grab whole fragment, move it spatially. Default.
- **Text highlighted + click-drag on highlight** → grab only the highlighted span. Implicit split-range.
- **Reading mode (no interaction)** → pure prose. No highlights, no selection cues.

## Sibling visibility

Canvas shows ONE traversal of the tree at a time — the active reading path. Siblings of fragments not currently being manipulated are *invisible* on canvas. To see all branches, switch to tree view.

**Exception:** during inline operations (reroll-phrase, extend), alternatives appear *temporarily* and *locally*, color-coded to mark them as alternatives. They are ephemeral — pick one and the rest fade. This is "a zoomed-in part of the tree" rendered inline, not a permanent surface.

## Provenance

Marked subtly. Not loud color blocks. Probably:
- Faint left-edge tint (1-2px) per provenance type, OR
- Slight kerning / weight differences per author

Strong color is reserved for ghost alternatives during operations. Default reading should be visually quiet.

## Build sequence

These compose forward — each step builds on the last toward the full vision.

### Experiment 0 — mechanical floor

Fix the immediate blockers regardless of design:
- **Auto-fit viewport** on canvas open: compute bounding box, center, zoom-to-fit + padding.
- **Re-layout gesture**: button or shortcut that throws out stale `canvasPositions` and re-seeds from dagre + jitter. Saves the result.
- **Fix dead `else` in `src/app/page.tsx`** (references `tree` outside scope; unreachable but TS smell).

### Experiment A — strip & flow (the visual baseline)

The new look without behavior changes:
- Remove rectangle border, model badge, version pip, `pick`/`extend`/`edit`/`stage` buttons from default fragment render.
- Render text via Pretext (`@chenglou/pretext`, already a dep) for elegant line breaks.
- Provenance shown as 1-2px left-edge tint or subtle text-weight cue.
- Hover (or selection) summons a minimal toolbar.

**Why this comes before phase-transition behavior:** the deformation only feels right if the visual is already quiet. Adding deformation to ugly cards just makes ugly cards that move.

### Experiment B — column-snap (first phase transition)

When two fragments come within `r_flow` of each other:
- Their layout context unifies (shared column width, aligned baselines).
- Visible "magnetic" affordance — they snap into the same column rather than overlapping.
- This is the first taste of "they want to flow together."

Reuses physics simulation; tunes attraction/repulsion to encourage snap-into-column not snap-onto-target.

### Experiment C — merge-on-hold with flow gradient

Extend the existing collision-merge:
- As distance closes, intermediate visuals (text starts to wrap toward neighbor, gap fills with prose-spacing) build anticipation.
- After hold-time at merge distance, run `/api/tree/merge`.
- Pulling apart before merge: gracefully un-flows.

This is the central magic of the design. May be too much for a single autonomous run.

### Experiment D — inline alternatives

When the writer rerolls a span or extends from a cursor:
- Alternatives appear inline as colored ghost text (not modal, not in a sidebar).
- Tab to accept current, arrow keys to flip through alternatives, Esc to cancel.
- The "local zoomed-in tree" rendered as ephemeral inline ghosts.

May overlap with existing reroll-phrase UX. Will inspect what's there before designing.

## What I will NOT do in this run

- Tree view redesign (separate concern; canvas is the priority).
- Chat view repurpose ("behind-the-hood" debug view) — vision but not this run.
- Linear session removal cleanup — happens naturally when canvas is the only entry.
- Single-flow canvas (Cut 4 from the earlier proposal) — the user explicitly chose spatial-2D-with-deformation over single-flow.
- Any new data model. Fragments + edges + sequence + canvasPositions stays as-is. The redesign is rendering + interaction, not state.

## Defaults I'll commit to without asking

- `r_merge` = ~80px (within node width, intuitive proximity)
- `r_flow` = ~280px (one-paragraph-width gap)
- Hold-time before merge = 2s (matches existing collision-merge)
- Provenance color palette: stone-50 (human), warm-amber-200 (Sonnet), cool-cyan-200 (Haiku), pale-violet-200 (other), each only as faint left-edge tint
- Canvas background: stone-950 (matches current)
- Pretext font: 16px system-ui (matches WordLevelContent)
- Action toolbar lives in a hover-popover above the fragment, not always-on

If these turn out wrong on review, they're easy to tune.

## How to read the artifact when you return

- `PROGRESS.md` — chronological journal of what I did each step, surprises, decisions.
- `experiments/000-mechanical/`, `experiments/001-strip-and-flow/`, etc. — each has `NOTES.md`, screenshots, and a git ref.
- `SYNTHESIS.md` — final summary with recommendation and what to do next.
- The branch tip is the latest state; earlier states are tagged or commented in PROGRESS.

The canvas should be visibly different from what you saw at session start. If it isn't, something blocked progress and PROGRESS.md will say what.
