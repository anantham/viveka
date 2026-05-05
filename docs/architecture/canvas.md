# Architecture: Canvas + Workspace (current state, 2026-05-05)

This is the one-page authoritative description of how the canvas + workspace actually works today. ADR-002 is the design that initiated the work; this document describes what shipped and how the May 2026 phase-transition redesign sits on top of it. If something here disagrees with an ADR, this document wins for "what's running."

## Frame

Viveka is an **exoskeleton for writing**. The canvas is the wizard's table where the writer arranges paragraph-shaped chunks of text in 2D space. AI is a copilot, not a chatbot — operations land inline, in the prose, without forcing a chat-style turn structure. Tree view is the comprehensive overview of all branches; chat view is the legacy compatibility surface.

## Data model: the `Workspace`

`src/lib/workspace.ts`. Three independent structures (per ADR-002 §"Three Independent Structures"):

- **`fragments: Record<string, Fragment>`** — the atoms of content. Each has an id, content, provenance (who/what produced it), status, and `previousVersions[]` for undo.
- **`edges: Edge[]`** — append-only generative history (`responded-to`, `split-from`, `derived`, `imported-from`).
- **`sequence: string[]`** — reading order. Mutable. The "active path" through the tree.
- **`stageIds: string[]`** — fragments visible to the human but excluded from AI context.
- **`canvasPositions: Record<string, {x, y}>`** — user-pinned spatial positions. Defaults derive from dagre.
- **`opLog: Operation[]`** — append-only history of mutations for replay/undo.

**Provenance types** in current use: `human-typed`, `ai-generated`, `split`, `extracted`, `imported`, `derived`, `merged`, `system`.

**Migration note (open):** the older `src/lib/tree.ts` (`ConversationTree` / `TreeNode`) still exists and is imported by some loom view components. New API routes and stores use `Workspace`; the canvas redesign migrated all FULL-render logic to `Workspace`. Completing the migration (deleting `tree.ts`, switching the remaining loom/* components) is the next code-debt item — not yet done.

## Canvas surface

`src/components/loom/WorkspaceCanvas.tsx`. The primary writing surface. Renders one traversal of the workspace per the vision: only `sequence` + `stageIds` + actively-generating fragments. Sibling alternatives that are not picked are hidden on canvas (the stat badge shows `N alts hidden`); they appear in tree view.

### Layout pipeline

1. **Dagre** (`computeDagreLayout`) lays out sequence fragments top-to-bottom using per-fragment heights from `heightFor()`. Heights come from real DOM measurements via `ResizeObserver` (preferred) or a content-length estimator as fallback. Width is the canonical `NODE_WIDTH_FULL = 480` regardless of current viewport zoom.
2. **Stage column** at `STAGE_X_OFFSET = 600` for stage-zone fragments.
3. **Physics** (`usePhysicsSimulation`) ticks at 60fps with three forces:
   - **Bbox-overlap repulsion** (constant `BBOX_OVERLAP_FORCE = 0.35`) pushes fragments apart whenever their rendered boxes intersect with > 8px padding. Gentle to avoid thrashing. Skipped when either particle is pinned (so the merge-by-overlap gesture isn't fought).
   - **Center-distance repulsion** (`REPULSION_STRENGTH = 80000`, falloff `1/dist²`, max range `MAX_REPULSION_DIST = 600`) for at-distance spacing.
   - **Dagre spring** (`DAGRE_SPRING_K = 0.015`) pulls each particle gently toward its dagre target so the layout doesn't drift.
   - **Edge spring** between connected fragments with `EDGE_REST_EXTRA = 60` extra gap.
4. **Manual positions** (`manualPositions`) override physics during drag; cleared on release so physics can claim ownership.
5. **Auto-fit** runs once per workspace open: bounding box of visible fragments → pan/zoom to fit with 8% padding, capped at 1.5× zoom. Manual `[fit]` and `[re-layout]` buttons in the top-right corner.

### Pan / zoom

`src/hooks/usePanZoom.ts`. CSS `transform: translate(panX, panY) scale(zoom)` on the inner content div. Three input modes:

- **Two-finger trackpad scroll** → pan
- **Mouse wheel** → pan
- **Cmd/Ctrl + wheel** → zoom toward cursor
- **Left-click drag on canvas background** (no fragment under cursor) → pan
- **Middle-click drag** → pan

Layout/physics use canonical `NODE_WIDTH_FULL`/`heightFor` regardless of viewport zoom — pan/zoom is a pure viewport operation, no physics-side perturbation.

### Semantic zoom

Visual rendering switches LOD per zoom level (purely cosmetic — does not affect layout coordinates):

- **dot** (< 20% zoom) — colored circle per fragment.
- **compact** (20–45%) — single-line preview with provenance stripe.
- **summary** (45–80%) — first/middle/last line preview with stripe.
- **full** (≥ 80%) — full content with hover toolbar, inline operations, etc.

## Phase-transition gestures

The May 2026 redesign added three behaviours that compose into the writing-exoskeleton vision.

### Proximity gradient (Experiment B)

When two visible fragments are within `R_FLOW = 280` canvas units, an ambient teal halo + mint core line appears between their nearest edges. Intensity scales linearly with closeness. Pure visual cue — does not change positions or text. Tells the writer "these two are close enough to merge if you want."

### Merge by hold (Experiments C v1 + v2)

When the user drags fragment A onto fragment B and their bboxes overlap by ≥ `MERGE_OVERLAP_MIN = 50` px in **both** dimensions, they enter merge-candidate state:

1. **Hold (0–2s)** — `MergeSpinner` appears at target's center, color-coded by approach angle (blue=append, amber=prepend, violet=interleave, teal=summarize). The proximity gradient between this pair recolors to the merge variant. Source and target opacity fades from 1 → 0.15 over 1.6s. A `MergePreview` overlay renders an approximate concatenation as one continuous prose paragraph at `min(source, target)` position, opacity ramping 5% → 90% over the hold.
2. **Confirm (2s)** — `mergeCandidate.confirmed = true`. A `POST /api/tree/merge` fires. The merged fragment is created with status `generating` and `timing.startedAt` set immediately. Source/target contents are stashed in `previousVersions[]` and overwritten with `[merged into <id>]` placeholders; their status becomes `pending` and they're removed from `sequence`/`stageIds`. The `Operation.merge` log entry records `preMergeSnapshot` (sequence indices) for unmerge.
3. **Post-confirm fusion** — once `dragState` is null (user released), source position snaps to target position via a 0.6s cubic-bezier transition on `left/top`. By the time Claude returns, the visual has been: drag → spinner → preview → fragment glides into target slot.
4. **Hysteresis cancel** — pulled apart so overlap drops below `MERGE_HYSTERESIS_MIN = 10` px in either dimension → merge candidate clears, fragments return to full opacity.

Merge can be reversed via the `↶ unmerge` button in any merged fragment's hover toolbar. `POST /api/tree/unmerge` pops `previousVersions` to restore source content, restores them to their pre-merge sequence positions (using `preMergeSnapshot`), and deletes the merged fragment along with its derivation edges.

### Inline preview operations (Experiment D)

**Replace** (split toolbar's `replace` button on a text selection): `POST /api/tree/reroll-phrase?ephemeral=true` returns N alternative phrases without creating any siblings. The fragment renders with the original phrase substituted by the current alternative in a violet highlight. A small badge above the fragment shows pending countdown then `← K/N → ↵ pick · esc revert`. Arrow keys cycle, Enter commits via `POST /api/tree/edit`, Esc reverts.

**Extend** (hover toolbar's `extend` button): `POST /api/tree/generate?ephemeral=true` returns N candidate continuations. The fragment renders with an emerald ghost continuation appended. Same arrow-cycle UX. Enter commits via `POST /api/tree/append-child` (a single new child fragment, not N siblings); Esc discards all.

Crucially, neither operation creates persistent siblings during the preview. Discarded alternatives never enter the workspace data.

## API surface (current)

Routes under `src/app/api/tree/*`:

- `create`, `get`, `session`, `export` — workspace lifecycle.
- `generate` — extend; `ephemeral=true` for ephemeral preview.
- `draft` — multi-completion drafts (legacy linear flow).
- `reroll-phrase` — replace; `ephemeral=true` is the new default.
- `edit` — in-place content update (`previousVersions` stack pushed).
- `append-child` — minimal endpoint to add one fragment as sequence child (commit path for extend).
- `merge` — collision-merge runs Claude with light-edit prompt.
- `unmerge` — restore from `previousVersions` + `preMergeSnapshot`.
- `split-range`, `split` — split a fragment by char range.
- `move`, `select`, `prune`, `zone` — sequence/stage manipulation.
- `canvas-positions` — persist user-pinned positions; `replace: true` flag wipes for re-layout.

## Layered backend invariants

- **Append-only `opLog`** (ADR-002 §F4). All call sites use `.push()` — no test enforces this beyond convention. Worth a written assertion in `docs/proofs/oplog-append-only.md`.
- **`previousVersions` is the undo stack.** `updateFragmentContent` pushes before overwriting. `merge` and now `edit` both rely on this. `unmerge` pops.
- **Sources removed from sequence after merge.** Plus `[merged into X]` content placeholder, plus `status = pending`. Three independent guarantees that together hide source fragments from canvas.

## What's deferred (vs ADR-002 requirements)

Tracked here so it's not silent drift:

- **§F2.6 Aperture controls** (token budget, source filters, relevance window). `ContextPanel.tsx` exists but has only a token meter; aperture UI not built.
- **§F2.7 Cursor modes** — original spec had Select / Hand / Type / Pull. Current canvas is gesture-driven (Select / Tangent / Grab) and Type / Pull don't exist. The toggle was removed in favor of context-sensitive cursor changes (text → I-beam, fragment chrome → move, canvas → grab).
- **§F5.5 Compaction view** — Mode F treemap not built.
- **§F5.6 Lineage view** — not built.
- **Phase 0.5 cross-session intelligence** — see `docs/roadmap.md`.

## Open code-debt items

- Complete the `tree.ts` → `workspace.ts` migration (delete `tree.ts`, archive `trees.json`, switch remaining loom view imports).
- Consolidate duplicate types (`Provenance`, `GenerationParams`, `Operation`, `getWorkspaceContext`) defined in both modules with overlapping but non-identical shapes.
- `WorkspaceCanvas.tsx` is at 1535 LOC; a split into `WorkspaceCanvas` + `useFragmentInteractions` + `useMergeFlow` would help.
- The `wordMode` toggle in `LoomInterface` header is a half-built prototype; either polish or remove.
