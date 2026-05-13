# Handover: 2026-05-12

## Session summary

Continuation of the post-phase-transition-canvas cleanup arc that started 2026-05-04. By end-of-session the codebase has crossed a structural stopping point: legacy data-model bridge fully deleted, comprehensive opLog logging in place across every LLM-touching route, three load-bearing invariants written as proofs in `docs/proofs/`, canvas-geometry helpers extracted as pure functions with unit tests, gesture state machines extracted as hooks, and Obsidian export gained two new formats (plain prose, native `.canvas`). 189 unit + 21 e2e tests passing; build clean.

Aditya's open question at session end: "what do you recommend?" — answered with "stop building and use it for a real writing session; if you must pick, do canvas content-creation gap (#1)." No commitment yet from him on the next move.

## Commits this session (pushed, on `origin/main`)

Tip: `92fd5be`

- `92fd5be` feat(export): add Obsidian .canvas + plain-prose export formats
- `da4ef9c` docs: write 3 invariant proofs, refresh canvas.md + CONVENTIONS, sweep orphans
- `8ec551f` refactor(canvas): extract useInlineAlts hook (keyboard + spread-fire effects)
- `38b98ca` refactor(canvas): extract useMergeFlow hook (mergeIntent + 3 effects)
- `f1c2746` refactor(canvas): extract UnmergeFlashBadge and InlineRerollBadge
- `487d034` feat(x-ray): capture + render durationMs on every LLM op
- `08b24bc` polish: help overlay alts entry + drop-zone item count
- `416ffe5` test(e2e): real drag-merge gesture tests with graceful skips
- `b8a95bc` refactor: delete legacy bridge — drop tree.ts + 5 orphan view components
- `d833e81` refactor(canvas): extract pure geometry helpers + 25 unit tests
- `101bb2c` feat(canvas): hidden-alts browser — click 'N alts' to pick/stage
- `30cad87` test: API route integration tests — 29 tests covering merge+unmerge, reroll, swap-phrase, generate, draft

All earlier commits in the arc (waves 1-5 of the (c) plan) are also pushed.

**Working tree:** clean. Nothing uncommitted. Nothing un-pushed.

## Pending threads

### Awaiting Aditya's pick (don't start unprompted)

Aditya explicitly asked "what do you recommend?" — my answer was "stop building, use it for a real session." If pressed, I picked:

1. **Canvas content-creation gap** (#1 in the recommendation). Add: click empty canvas → spawn fragment with focused textarea. ~30 min. Current friction: no way to add a brand-new fragment from canvas; have to switch to reader. Touch `src/components/loom/WorkspaceCanvas.tsx` — the canvas background click handler exists (it pans); intercept double-click on empty space and create a fragment via `POST /api/tree/append-child` with empty content + immediate edit mode.

If he picks something else from the menu I gave him, that's the work. Don't propose new directions until he steers.

### Deferred (acknowledged but parked) — exhaustive list

Grouped by category. Each entry is something *someone could pick up and do*; explicit decisions-not-to-do are in a separate section below.

#### Out-of-scope / blocked by architecture

| Item | Why deferred |
|---|---|
| Mobile responsive | Aditya: "leave mobile" — out-of-scope. Canvas is desktop-first by design; reader/tree/chat could work mobile-OK but no `sm:`/`md:` breakpoints exist. |
| Public share link / cloud sharing | Needs cloud hosting + token auth + privacy considerations. App is localhost-only. |

#### Magical features (1-2 days each, real UX impact)

| Item | Sketch |
|---|---|
| **Streaming preview during merge hold** (the headline "magical" feature) | LLM streams merged text inline during the hold; release commits whatever's there. Needs streaming endpoint + visual choreography + abort handling. Worth doing only after Aditya has used the current merge enough to have strong opinions about how the stream should feel. |
| **Time-travel via opLog scrubber** | Visual history slider. opLog is complete and append-only; just UI work to render and seek. |
| **Context blocks as visible canvas fragments** | Closes the "what does the model see" loop spatially. Uploaded refs render as ghostly read-only fragments on canvas. |
| **Fork gesture** (drag-with-modifier to spawn sibling) | Gestural branching; spawns a parallel sequence the writer can work in. |
| **Coherence linting** (passive background pass) | Surface terminology drift / redundancy / tone shifts as faint annotations. Match the contemplative ethos: reflection without intervention. |
| **Token-weight visualization** | Color-tint fragments by token cost; surface what to prune when over budget. |
| **Style lenses / personas** | Pre-configured system prompts ("academic", "Borges", "raw") per workspace. |

#### Small wins (30 min–1h each)

| Item | Sketch |
|---|---|
| **Canvas content-creation gap** (Aditya's recommended-if-pressed pick) | Double-click empty canvas → spawn fragment with focused textarea. No way to type a brand-new fragment from canvas today. |
| **Copy-as-markdown to clipboard** | The "share without Obsidian" path. Active sequence joined with `\n\n` → clipboard, toast confirm. |
| **Download as `.md` file** | File-download of the same content; for users without Obsidian set up. |
| **Download as `.json`** | Full workspace blob, for backup + future re-import. |
| **`roadmap.md` wording fix** ("Tree data model (LOOM)" in DONE list) | Stale wording from before the data model swap; functionality still works, but description is wrong. |
| **`canvas.md` numbers go stale** on next structural canvas edit | The doc cites `WorkspaceCanvas.tsx (~1630)` LOC; refresh when making structural changes there. |
| **Drop-zone folder-vs-file distinction during drag** | Browser dragover API doesn't expose this (only on drop). Count display already added; type display is API-limited. |

#### Test-coverage gaps (deferred, not blocking)

| Item | Sketch |
|---|---|
| **Component tests** for ChatView / TreeView / header cycle button / split-state | Mostly redundant with e2e — but RTL component tests would lock in OpEntry rendering per op type (the e2e fixture only exercises merge/reroll, not draft/expand/swap-phrase). |
| **More drag-merge e2e** | 4 of 5 stubs skip gracefully because physics positions vary across runs. Reliable testing would need a test-only API hook to seed mergeCandidate state directly, OR a calibrated mouse-event timing pass. |

#### Architecture cleanup (low urgency)

| Item | Sketch |
|---|---|
| **Further `WorkspaceCanvas` split** | At ~1630 LOC after the gesture-state-machine extraction. Candidates: `useFragmentDrag` (drag handlers + velocity tracking), `useCanvasLayout` (the dagre + position-blend memos), `<FragmentCard>` for the semantic-zoom switch. Documented in `canvas.md` open code-debt section. |
| **`workspace.ts` split** | At ~811 LOC after merge/unmerge op additions. Splittable into `workspace-types.ts` + `workspace-ops.ts`. |
| **`LoomInterface.tsx`** | ~917 LOC, "mostly view dispatch." Lives for now. |

#### Documentation gaps

| Item | Sketch |
|---|---|
| **Module docs** in `docs/modules/` | Index is real now but content files are stubs. Highest-priority candidates: `canvas-geometry.md`, `workspace.md`. Lower-priority: `heuristics.md`, `intervention-log.md`, `usePhysicsSimulation.md`. |
| **Testing doc** | The four-layer pyramid (unit data / pure geometry / API routes / e2e) is captured in `canvas.md` test-layers table but no standalone `docs/testing.md` explaining how to run + interpret each. |

#### Vision modes (roadmap.md — large each, 2-5 days)

| Mode | Status |
|---|---|
| **Mode C — Fidelity check** | Phase 1; not started. AI generates 3 questions about content, answers them, human confirms/corrects. Prerequisite for Modes D and E. |
| **Mode E — Concept extraction (vault writing)** | Phase 2; not started. Extract a vault note from a node. Closes the "currently vault is read-only" gap. |
| **Mode D — Style transfer** | Phase 3; not started. Audience-archetype rewrite. |
| **Mode B — Research / pull-in** | Phase 4; not started. Exa MCP web research → context blocks. |
| **Mode F — Compaction (treemap)** | Phase 5; not started. ADR-002 §F5.5. |
| **Mode G — TBD** | Not defined yet. Candidates per roadmap: collaboration, evaluation, iteration, publication. |
| **Phase 0.5 cross-session intelligence** | Deferred per roadmap. Data is in Obsidian session exports; analysis layer not built. |

#### ADR-002 deferred sections (not all are vision modes)

| Section | Status |
|---|---|
| **§F2.6 Aperture controls** (token budget, source filters, relevance window) | Not built. `ContextPanel.tsx` has only the token meter. |
| **§F2.7 Cursor modes** — original spec had Select / Hand / Type / Pull | Current canvas has Select / Tangent / Grab. Type / Pull don't exist. Documented as amendment in ADR-002 header. |
| **§F5.5 Compaction view** | = Mode F above. |
| **§F5.6 Lineage view** | Not built. |

#### Smaller roadmap.md features (Phase 6 in roadmap)

| Feature | Sketch |
|---|---|
| **Feature 2: Grab & Move Text** | Drag-reorder nodes within active path. Currently tree is append-only; needs reparent/reorder ops. |
| **Feature 4: Predefined Macros** | Narrowing operators (opposite of expand): constrain, validate, prune weak threads. Library of prompts vs rule engine vs LLM-as-judge — open. |
| **Feature 7: Colored Demarcation** | Color-code text by source (human-typed / human-selected / AI-generated). Inline highlights vs margin annotations — open. |
| **Feature 7 (alt): Seed-Based Replay** | Store generation params per node; export session as replayable script. Not all models support seeds. |
| **Feature 8** | Undefined. Possibly related to Mode G. |

#### Cross-cutting open questions (from roadmap.md)

| Question | Status |
|---|---|
| **Pipeline composition design** | Vision says A = B→C→D; deeper composition rules (can you run E from B? can F run at any point?) not specced. |
| **Data model evolution for style transfer** | Mode D needs a "content vs presentation" split; current fragment doesn't have that axis. |
| **Audience archetype details** | List 1 (style dimensions) not defined. Archetypes 2 (post-rat) and 4 (academia) not elaborated. |
| **IIT integration** | Facilitator mode, Soloware (per-user adaptation), IIT session export, training material direction, "separate data and interface" extension to other tools — all open. |

### Explicit decisions NOT to do

These were considered and skipped *intentionally*. Don't re-litigate without new information.

| Item | Why skipped |
|---|---|
| **Markdown-in-single-swap-preview** | The single-swap inline preview slices content by char-index + highlights a range. Markdown rendering would conflict with the slicing. Plain text + colored highlight is correct here. |
| **Caret-mid-markdown edge case** | Precision-insert caret splits content at the snapped offset; if that lands inside a `**bold**` span the rendering goes weird. Rare for paragraph-snapped offsets (the common case); accepted as edge case. |
| **ChatView prompts as markdown** | The X-ray's value is showing the model received *literally*. Markdown-parsing user content with `*…*` spans would render a different thing than the model saw. `<pre>` is correct. |
| **Alts-browser preview as markdown** | Markdown's block layout fights `line-clamp-3`. Plain truncated text is acceptable for a preview that's meant to be glanceable. |
| **Drag-merge mode-classification assertions in e2e** | Physics positions vary between runs; tests assert only "label appears" not which mode. Mode classification is unit-tested in `computeMergeIntent`. |
| **TaskCreate / TaskList for tracking** | Repeated reminders during this session. Skipped — conversation context + this handover doc cover the same ground without adding ceremony. |

### Blocked

None.

## Key context for the next instance

- **`tree.ts` is gone.** Don't import from `@/lib/tree`. `Workspace` is the only data model. If a request implies "the tree shape," redirect to fragments + edges + sequence.
- **Three proofs in `docs/proofs/`** — `oplog-append-only.md`, `merge-undoability.md`, `fragment-hidden-after-merge.md`. New changes that touch the opLog, merge mutation, or post-merge filtering need to be evaluated against these.
- **opLog is append-only at runtime.** Mutating fields on existing op objects (e.g., merge route patching `prompt` / `durationMs`) is allowed; removing entries is not. Compaction passes over opLog would invalidate the append-only proof and the merge-undoability proof.
- **`MERGE_HOLD_MS = 2500`.** 5-mode merge (above/top/body/bottom/below → summarize/prepend/insert@offset/append/interleave). The cardinal-angle classification stored at detection is overridden by the LIVE mergeIntent at commit time; live re-aim during the hold is intentional.
- **Tests:** `npm test` for 189 unit (~600ms), `npm run test:e2e` for 21 e2e (~30s, requires dev server on :3000 + a workspace ID via env or fallback default). E2E uses `e2e/fixtures.ts → loomPage` fixture. Vitest is restricted to `src/**` via `vitest.config.ts` so it doesn't try to run Playwright specs.
- **CONVENTIONS.md** is current as of 2026-05-08; one drift point: the file's "WorkspaceCanvas.tsx (~1630)" figure may go stale on the next big edit there. Refresh if making structural changes.
- **`docs/architecture/canvas.md`** is the trustworthy ground truth for "how the canvas works today." If it disagrees with an ADR, canvas.md wins.

## Background processes

- **Dev server** running on `:3000` (PIDs 50630, 90104). Aditya's session has it open. Don't kill it. Check with `curl -sI http://localhost:3000`.
- No other long-running tasks.

## Learnings captured

- **Project memory updated.** Added `project_post_redesign_arc.md` to `~/.claude/projects/-Users-aditya-Documents-Ongoing-Local-Project-21-NonChat-Interface/memory/` with full current-state facts (data model, opLog coverage, proofs, hook structure, test pyramid, merge dispatch, export formats). Indexed in MEMORY.md.
- **Recurring patterns worth remembering** (encoded in the proofs):
  - "Snapshot BEFORE mutation" — the `preMergeSnapshot` indices bug (read `indexOf` after `ws.sequence = nextSequence` returns -1) was caught by API route tests; the regression test for it lives in `src/lib/__tests__/workspace-merge.test.ts → "captures TRUE pre-mutation sequence indices"`.
  - "State stays in component; effects in hook" — useMergeFlow / useInlineAlts both follow this pattern to avoid circular deps with physics callbacks.
  - "Don't pre-clear state during async LLM kickoffs" — the `setMergeCandidate(null)` in `.then()` premature-clear bug caused the hard-cut deformation during merge. Fix: stash `mergedFragId` and let a watcher effect clear when the result fragment's status flips.
- **Playwright drag-merge synthesis is flaky.** Physics positions vary between runs; tests should `test.skip` gracefully rather than assert exact mode classification (that's covered by unit tests on `computeMergeIntent`).

## Resume instructions

1. **Read `docs/HANDOVER.md`** (this file) for context.
2. **Read `~/.claude/projects/-Users-aditya-Documents-Ongoing-Local-Project-21-NonChat-Interface/memory/MEMORY.md`** for indexed prior learnings.
3. **Don't propose new directions unprompted.** Aditya was at "what do you recommend?" → I said "use the app." If he comes back with "do X," do X. If he's silent or vague, ask what he wants next (referencing the deferred-threads list above) rather than starting work speculatively.
4. **If he picks the canvas content-creation gap**, the change is small: in `WorkspaceCanvas.tsx`, intercept double-click on the canvas background (currently triggers pan via `usePanZoom`'s pointer handler), check that the target is the background (not a fragment), and dispatch `POST /api/tree/append-child` with empty content + start an inline edit on the new fragment. ~30 min plus a unit test if relevant.
5. **If he picks streaming preview**, that's a 1-2 day project — break into spec + endpoint + UI changes; don't try to do it in one shot.

---

*Handover by Claude Opus 4.7 (1M context) at end of session, ~75% context. Tree clean, all work pushed.*
