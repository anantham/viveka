# Viveka conventions

What the codebase actually does, captured so future audits and contributors have a ground truth. Surfaced patterns, not aspirations — every entry points to representative code.

## File / module layout

- **App routes**: `src/app/.../page.tsx` for views, `src/app/api/.../route.ts` for API handlers. One handler per file. Filename is always `route.ts`. Example: `src/app/api/tree/merge/route.ts`.
- **Domain libraries**: `src/lib/<name>.ts`. One concern per file. Examples: `workspace.ts` (data model), `claude.ts` (LLM CLI wrapper), `obsidian.ts` (vault I/O), `heuristics.ts` (pattern flags).
- **State stores**: `src/lib/<name>-store.ts`. Read-all / save-all on JSON file under `.viveka-data/`. Examples: `workspace-store.ts`, `session-store.ts`, `tree-store.ts`. Stores never expose mutators that take partial deltas — callers always read the whole record, mutate in memory, and save the whole record back.
- **Hooks**: `src/hooks/use<Name>.ts`. Examples: `usePanZoom.ts`, `usePhysicsSimulation.ts`.
- **Components**: `src/components/.../<Name>.tsx`. Loom view components in `src/components/loom/`.

## Data persistence

- **One JSON file per concept** under `.viveka-data/`: `workspaces.json`, `sessions.json`, `trees.json` (legacy), `intent-templates.json`, `llm-config.json`, `model-capabilities-cache.json`.
- **Single-user, file-backed.** No database. The whole `.viveka-data/` directory is the durable state.
- **Camel-case JSON shapes.** Match the TypeScript interface. No snake_case / kebab-case. Examples: `canvasPositions`, `previousVersions`, `sourceFragmentIds`, `siblingNodeIds`.

## API route conventions

- All API routes are `POST` unless they truly have no body. `GET` is used for reads where it's sensible (`/api/sessions` list, `/api/tree/get` exists alongside the `POST` form for legacy reasons).
- **Request body is always JSON** (`headers: { "Content-Type": "application/json" }`).
- **Responses always use `NextResponse.json(...)`**, never raw streams.
- **Error shape**: `{ error: string }` with appropriate HTTP status (400 for missing fields, 404 for not-found, 500 for internal). Sometimes also a `raw` field for debugging (e.g., when LLM JSON parse fails).
- **Success shape varies by endpoint** but typically returns the affected entity's id and a status: `{ nodeId, status: "complete" }` or `{ resultId, status: "generating" }`.
- **Mutating endpoints fire-and-forget LLM calls** when they return immediately with pending IDs (e.g., `/api/tree/generate`, `/api/tree/merge`). The caller polls a get endpoint until status flips to `complete`.
- **Ephemeral mode is opt-in via a body flag.** `/api/tree/generate` and `/api/tree/reroll-phrase` accept `{ ephemeral: true }` to return alternatives without writing fragments. The frontend handles commit via a separate write endpoint (`/api/tree/edit`, `/api/tree/append-child`).

## Workspace data conventions

- **`Fragment.id` is a UUID v4** generated server-side by `addFragment()`.
- **`previousVersions: string[]` is the undo stack** for content changes. Every mutation that overwrites `Fragment.content` must push the previous value here first. Used by phrase-edit undo and by `/api/tree/unmerge`.
- **`opLog: Operation[]` is append-only.** Never mutate or delete entries. `unmerge` does not remove the original `merge` entry — it appends a new `unmerge` entry.
- **`canvasPositions` is sparse.** Missing entries mean "use dagre default." A re-layout writes `{}` to clear all entries; the `replace: true` flag on `/api/tree/canvas-positions` enables this.
- **Stage vs sequence vs unplaced is mutually exclusive on canvas, not in data.** A fragment can technically be in `sequence` and `stageIds` simultaneously (the API code asserts otherwise on each transition); the canvas filters routes a fragment to one bucket.

## React conventions

- **Client components are explicit.** `"use client";` at the top of every file that uses hooks or browser APIs.
- **No global state library** (no Redux, Zustand, Jotai). State lives in the closest sensible component or hook, lifted up only when shared.
- **Refs for mutable values that don't drive renders.** `useRef` is preferred over `useState` for things like timers, last-velocity tracking, drag offsets.
- **`useCallback` and `useMemo` are used liberally** because most hot components have ResizeObserver / RAF loops that allocate per render. Don't optimise prematurely on cold paths.
- **ResizeObserver gotcha**: don't depend on a value that's recomputed every render (e.g., a default `[]` for an array prop) inside a `useEffect` deps array — it causes infinite loops. Memoise or omit.

## Styling

- **Tailwind utility classes inline.** No CSS modules, no styled-components. Arbitrary values via `[...]` syntax (`text-[15px]`, `-inset-[14px]`).
- **Color palette is stone-based** with semantic accents:
  - Provenance: `emerald` (human), `blue` (ai), `violet` (split / replace), `amber` (imported / prepend), `teal` (derived / summarise), `rose` (warning / unmerge).
  - Status: `red-400` for error, `emerald-400` for success.
- **Stripe-not-border for fragments**: `border-l-2 border-l-<color>-500/N` rather than full-fragment borders.
- **Hover chrome** uses `group-hover:opacity-100` with a `pointer-events-none` toolbar that becomes `pointer-events-auto` on hover.

## Cursor / interaction conventions

- **`cursor-text`** for text content (selection).
- **`cursor-move`** for fragment grab zones (drag).
- **`cursor-grab`** for canvas background (pan).
- **`cursor-pointer`** for buttons.
- **`cursor-grabbing`** is not used — the move/grab cursor stays during drag.

## Logging

- **Backend logs use bracketed source tags.** Examples: `[generate]`, `[merge]`, `[append-child]`, `[unmerge]`, `[viveka-loom]`. Useful for grep across server output.
- **Frontend logs use `[viveka-ui]` prefix.** Includes timing where relevant: `[viveka-ui] reroll-phrase returned in 2605ms — 5 alternatives`.
- **`console.log` is fine in development.** No structured logger.

## What we DON'T do

- No SSR for canvas-heavy components — they always carry `"use client";`.
- No CSS-in-JS, no preprocessor.
- No global request middleware. Each route handler validates its own body.
- No retries on LLM calls (fail loud).
- No optimistic UI updates that don't have a clear undo path. Every visible change must be reversible by a `POST /api/tree/...` call or by `Esc` for inline previews.

## File-size guideline

- Soft cap of 300 LOC per file. Warning signs:
  - `src/components/loom/WorkspaceCanvas.tsx` (1535) — split into hooks (`useFragmentInteractions`, `useMergeFlow`) is on the list.
  - `src/components/loom/LoomInterface.tsx` (990) — mostly view dispatch; lives.
  - `src/lib/tree.ts` (677) — legacy, will be deleted when migration completes.
  - `src/lib/workspace.ts` (504) — splittable into `workspace-types.ts` + `workspace-ops.ts` later.

A growing file is fine until it stops fitting in working memory; that's the trigger to split.
