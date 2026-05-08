# Architecture: Canvas + Workspace (current state, 2026-05-08)

This is the one-page authoritative description of how the canvas + workspace actually works today. ADR-001 set the founding constraints; ADR-002 redesigned the data model to fragments-as-primitives. This document describes what shipped, including the May 2026 phase-transition redesign and the cleanup pass that followed (legacy `ConversationTree` bridge deleted, comprehensive opLog logging across all LLM-touching routes, four pure-helper modules extracted from `WorkspaceCanvas`). If something here disagrees with an ADR, this document wins for "what's running."

## Frame

Viveka is an **exoskeleton for writing**. The canvas is the wizard's table where the writer arranges paragraph-shaped chunks of text in 2D space. AI is a copilot, not a chatbot — operations land inline, in the prose, without forcing a chat-style turn structure.

There are four views, each a *pure projection* of the same `Workspace`:

- **Canvas** — spatial 2D layout, gestures, drag-merge.
- **Reader** — linear flowing prose for the active sequence (`max-w-prose`).
- **Tree** — branching structural view; click any node to expand it inline and read the content.
- **Chat** — the *machinery* x-ray: chronological opLog with prompt + model + duration for every LLM call. NOT a chat-style turn-by-turn interface.

`split` is a *layout mode*, not a view: any two of the above can be paired in left/right panes, each with its own cycle button. Toggle with `⌘\` or the header `split` button.

## Data model: the `Workspace`

`src/lib/workspace.ts`. Three independent structures (per ADR-002 §"Three Independent Structures"):

- **`fragments: Record<string, Fragment>`** — the atoms of content. Each has an id, content, provenance, status, and `previousVersions[]` for undo.
- **`edges: Edge[]`** — append-only generative history (`responded-to`, `split-from`, `derived`, `imported-from`).
- **`sequence: string[]`** — reading order. Mutable.
- **`stageIds: string[]`** — fragments visible to the human but excluded from AI context.
- **`canvasPositions: Record<string, {x, y}>`** — user-pinned spatial positions. Defaults derive from dagre.
- **`opLog: Operation[]`** — append-only history of mutations. See `docs/proofs/oplog-append-only.md`.

**Provenance types** in current use: `human-typed`, `ai-generated`, `split`, `extracted`, `imported`, `derived`, `merged`, `system`.

**Migration status:** the legacy `ConversationTree` / `TreeNode` shape (formerly `src/lib/tree.ts`) was deleted on 2026-05-08 along with five orphan view components (`ChatBubbleView`, `TreeMapView`, `CanvasView`, `CanvasNode`, `VersionHistory`) and the `wsToLegacyTree` bridge. `Workspace` is now the only data model in the runtime.

## Canvas surface

`src/components/loom/WorkspaceCanvas.tsx` (currently ~1630 LOC; was 1938 before the gesture-state-machine extraction). Top-level state-machine hooks live alongside in `src/hooks/`:

- `useMergeFlow` — merge gesture lifecycle (hold timer, fire-API, status watcher, live mergeIntent).
- `useInlineAlts` — inline-alternatives lifecycle (keyboard handler, debounced spread-fire).
- `usePhysicsSimulation` — RAF physics loop (repulsion, springs, bbox-overlap, merge collision).
- `usePanZoom` — viewport pan/zoom transform.

Pure geometry helpers in `src/lib/canvas-geometry.ts`: `computeMergeIntent`, `computeEffectiveWidths`, `computeProximityPairs`, `snapToInsertionBoundary`. Unit-tested in `src/lib/__tests__/canvas-geometry.test.ts`.

The canvas renders one traversal of the workspace: only `sequence` + `stageIds` + actively-generating fragments. Sibling alternatives that are not picked are hidden on canvas (the bottom-right cluster shows `N alts` as a clickable button that opens an inline browser); they also appear in tree view.

### Layout pipeline

1. **Dagre** lays out sequence fragments top-to-bottom using per-fragment heights from `heightFor()`. Heights come from real DOM measurements via `ResizeObserver` (preferred) or a content-length estimator as fallback. Width is the canonical `NODE_WIDTH_FULL = 480`.
2. **Stage column** at `STAGE_X_OFFSET = 600` for stage-zone fragments.
3. **Physics** (`usePhysicsSimulation`) ticks at 60fps with three forces:
   - **Bbox-overlap repulsion** (`BBOX_OVERLAP_FORCE = 0.35`) pushes fragments apart whenever boxes intersect with > 8px padding. Skipped when either particle is pinned (so the merge gesture isn't fought).
   - **Center-distance repulsion** (`REPULSION_STRENGTH = 80000`, falloff `1/dist²`, max range `MAX_REPULSION_DIST = 600`).
   - **Dagre spring** (`DAGRE_SPRING_K = 0.015`) pulls each particle toward its dagre target.
   - **Edge spring** between connected fragments with `EDGE_REST_EXTRA = 60` gap.
4. **Manual positions** override physics during drag; cleared on release.
5. **Auto-fit** runs once per workspace open. Manual `[fit]` and `[re-layout]` buttons live in the **bottom-right** controls cluster (alongside the stat row and fullscreen ⤢ button).

### Pan / zoom

`src/hooks/usePanZoom.ts`. CSS `transform: translate(panX, panY) scale(zoom)`. Inputs:

- Two-finger trackpad scroll → pan
- Mouse wheel → pan
- Cmd/Ctrl + wheel → zoom toward cursor
- Left-click drag on canvas background → pan
- Middle-click drag → pan

Layout/physics use canonical `NODE_WIDTH_FULL`/`heightFor` regardless of viewport zoom — pan/zoom is a pure viewport operation.

### Semantic zoom

LOD per zoom level (cosmetic; does not affect layout coordinates):

- **dot** (< 20%) — colored circle per fragment.
- **compact** (20–45%) — single-line preview with provenance stripe.
- **summary** (45–80%) — first/middle/last line preview.
- **full** (≥ 80%) — full content with markdown rendering, hover toolbar, inline operations.

### Markdown rendering

Fragment content renders as markdown via `<MarkdownText>` (a thin wrapper around `react-markdown` with mono-preserving styling — bold/italic, headings still mono but bigger, list indents, inline + block code, blockquote, links). Wired into:

- `WorkspaceCanvas` FULL-zoom fragment render
- `WorkspaceCanvas` spread-swap preview (whole-fragment LLM-edited)
- `ReaderView` prose
- `TreeView` expanded node card
- `ChatView` NEXT-assembly cards + history outputs

Edit mode (textarea) keeps raw markdown. Single-swap inline preview keeps plain text + colored highlight (splicing-by-char-index conflicts with markdown's structural parsing; spread-mode renders the whole fragment as markdown instead).

## Phase-transition gestures

### Proximity gradient

When two visible fragments are within `R_FLOW = 280` canvas units, a halo + core line appears between their nearest edges. Intensity ramps to 1.0 at `R_MERGE = 90`. Pure visual cue. Implemented by `computeProximityPairs` in `canvas-geometry.ts`.

### Merge by hold + drop position (5 modes)

When the user drags fragment A onto fragment B and their bboxes overlap by ≥ `MERGE_OVERLAP_MIN = 50` px in **both** dimensions, they enter merge-candidate state. Mode selection is **live** during the hold — the writer can wiggle A over B to change the mode without restarting the timer.

The mode is chosen by A's vertical center within B's bounding box (`computeMergeIntent`):

| A's center vertical position | Mode | Behavior |
|---|---|---|
| above target | **summarize** (teal) | distill both into shorter synthesis |
| top edge (≤ 15%) | **prepend** (amber) | A then B, lightly stitched |
| body (15–85%) | **insert @ N** (emerald) | splice A into B at character offset N (snapped to ¶ / sentence / word) |
| bottom edge (≥ 85%) | **append** (blue) | B after A, lightly stitched |
| below target | **interleave** (violet) | sentences from both, woven |

`insert` mode renders an emerald-rule caret inside the target fragment at the snapped offset; the caret position updates live as A wiggles.

**Hold lifecycle** (`MERGE_HOLD_MS = 2500`):
1. **Hold (0–2.5s)** — `MergeSpinner` appears at target's center with a label like `merge ▸ append` or `merge ▸ insert @ 234`. Source and target opacity fades from 1 → 0.15. A `MergePreview` overlay renders an approximate concatenation in the merged fragment's slot.
2. **Confirm (2.5s)** — `mergeCandidate.confirmed = true`. A `POST /api/tree/merge` fires (with the LIVE mode and offset). Source/target contents are stashed in `previousVersions[]` and overwritten with `[merged into <id>]` placeholders; their status becomes `pending`. The merge op log entry records `preMergeSnapshot` (sequence indices + stage flags) for unmerge.
3. **LLM running** — `mergeCandidate` stays alive (with `mergedFragId` stashed) so `MergePreview` keeps rendering through the LLM call. The deformation does NOT hard-cut to a blank placeholder.
4. **Done** — when the merged fragment's status flips to `complete` or `error`, the watcher effect clears `mergeCandidate`, `MergePreview` unmounts, and the merged fragment renders with its filled content.

**Hysteresis cancel** — pulled apart so overlap drops below `MERGE_HYSTERESIS_MIN = 10` px → merge candidate clears.

**Unmerge** — every merged fragment carries a `↶ unmerge` button (auto-flashing for 30s after merge, then permanent on hover). `POST /api/tree/unmerge` pops `previousVersions` and uses `preMergeSnapshot` to restore. See `docs/proofs/merge-undoability.md`.

### Inline preview operations

**Replace** (split-toolbar `replace` button on text selection): `POST /api/tree/reroll-phrase?ephemeral=true` returns N alternatives. Fragment renders with the original phrase substituted by the current alternative in violet highlight. Arrow keys cycle, Enter commits via `POST /api/tree/edit`, Esc reverts.

**LLM-aware spread**: when the writer lands on an alternative in replace mode, a debounced (350ms) `POST /api/tree/swap-phrase` fires. The LLM identifies same-connotation occurrences elsewhere in the fragment and returns the whole-fragment edit. If it lands before commit, the preview swaps to the spread version (markdown-rendered) and Enter commits the spread. Falls back to literal single-range swap on error.

**Extend** (hover-toolbar `extend` button): `POST /api/tree/generate?ephemeral=true` returns N candidate continuations. Fragment renders with an emerald ghost continuation appended. Same arrow-cycle UX. Enter commits via `POST /api/tree/append-child`; Esc discards.

Neither operation creates persistent siblings during preview. Discarded alternatives never enter the workspace data.

### Hidden-alts browser

The bottom-right cluster shows `N alts ▾` as a clickable button when the workspace has unplaced alternative siblings. Clicking opens a side panel listing each alt with role / fragment id / token count / preview, and per-row pick (add to active sequence) / stage (park) buttons.

## Chat view: machinery x-ray

`src/components/loom/ChatView.tsx`. Two sections:

1. **NEXT — current assembly.** Every fragment in `getWorkspaceContext(ws)` shown in order with role label, short id, per-fragment token count. Total / max / percent at top. Click a fragment → focuses it in the canvas (when split).
2. **HISTORY — chronological opLog.** Newest first. Each `ai-generated` / `merge` / `reroll` / `expand` / `draft` / `swap-phrase` op is expandable: full prompt + model + durationMs + result content. Low-signal ops (`move`, `zone-transfer`, `prune`, `pick`) collapse to a single de-emphasized line.

**Coverage:** every workspace-touching LLM call now logs an op (`generate` / `merge` / `reroll-phrase` / `swap-phrase` / `expand` / `draft`). `merge` and `reroll-phrase` patch their op records with the constructed prompt + model + duration so the X-ray shows what the model literally received.

## API surface

Routes under `src/app/api/tree/*`:

- `create`, `get`, `session`, `export` — workspace lifecycle.
- `generate` — extend; `ephemeral=true` for ephemeral preview.
- `draft` — multi-completion draft replies.
- `reroll-phrase` — phrase replace; `ephemeral=true` is the default.
- `swap-phrase` — LLM-aware spread of a phrase swap across same-connotation occurrences. Falls back to literal replace-all on length mismatch / LLM error.
- `edit` — in-place content update (`previousVersions` stack pushed).
- `append-child` — minimal endpoint to add one fragment as sequence child (commit path for extend).
- `merge` — collision-merge runs Claude with light-edit prompt; supports the 5 modes including `insert` with offset.
- `unmerge` — restore from `previousVersions` + `preMergeSnapshot`.
- `split-range`, `split` — split a fragment by char range.
- `move`, `select`, `prune`, `zone` — sequence/stage manipulation.
- `canvas-positions` — persist user-pinned positions; `replace: true` flag wipes for re-layout.

Plus `src/app/api/expand/route.ts` (writing-mode threads/tensions/metaphors).

## Layered backend invariants

Each is documented in `docs/proofs/`:

- **Append-only `opLog`** — see `oplog-append-only.md`. Every call site uses `.push()` or patches fields on existing ops; nothing removes entries.
- **Merge undoability** — see `merge-undoability.md`. Every merge stashes content in `previousVersions` and a sequence-position snapshot in the op log entry.
- **Sources hidden after merge** — see `fragment-hidden-after-merge.md`. Three independent guarantees + four filter predicates.

## Test layers

| Layer | Location | Coverage |
|---|---|---|
| Pure data ops | `src/lib/__tests__/workspace*.test.ts` | createWorkspace, fragment CRUD, edges, sequence/zone ops, splitFragment, mergeFragments / unmergeFragments round-trip |
| Pure geometry | `src/lib/__tests__/canvas-geometry.test.ts` | computeMergeIntent (5 modes), computeEffectiveWidths, computeProximityPairs, snapToInsertionBoundary |
| Pure helpers | `src/lib/__tests__/{reroll-filter,fit-to-box}.test.ts` | regex behaviour, viewport math |
| API routes | `src/app/api/tree/__tests__/*.test.ts` | merge / unmerge / reroll / swap-phrase / generate / draft route handlers with mocked store + LLM |
| End-to-end | `e2e/*.spec.ts` | header chrome, view cycling, split layout, blocks dropdown, ChatView rendering, TreeView expand, drag-merge label visibility |

189 unit + 21 e2e currently passing. Run unit with `npm test`; run e2e with `npm run test:e2e` (needs dev server + a workspace id; defaults to one in `.viveka-data`).

## What's deferred (vs ADR-002 requirements)

- **§F2.6 Aperture controls** (token budget, source filters, relevance window). `ContextPanel.tsx` exists but only has a token meter; aperture UI not built.
- **§F2.7 Cursor modes** — original spec had Select / Hand / Type / Pull. Current canvas is gesture-driven (Select / Tangent / Grab); Type / Pull don't exist.
- **§F5.5 Compaction view** — Mode F treemap not built.
- **§F5.6 Lineage view** — not built.
- **Phase 0.5 cross-session intelligence** — see `docs/roadmap.md`.

## Open code-debt items

- `WorkspaceCanvas.tsx` is at 1630 LOC after the gesture-state-machine extraction. Further split candidates: `useFragmentDrag` (drag handlers + velocity tracking), `useCanvasLayout` (the dagre + position-blend memos), and a `<FragmentCard>` component for the semantic-zoom switch.
- Two orphan components (`GhostNode.tsx`, `ReadingPath.tsx`) in `src/components/loom/` — sweep candidates from the deleted CanvasView lineage.
