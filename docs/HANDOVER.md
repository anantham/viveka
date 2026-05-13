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

### Deferred (acknowledged but parked)

| Item | Why deferred |
|---|---|
| Mobile responsive | Aditya: "leave mobile" — out-of-scope. |
| Public share link | Needs cloud architecture; app is localhost-only. |
| Streaming preview during merge hold (the headline "magical" feature) | Real engineering effort — needs streaming endpoint + visual choreography + abort handling. Worth doing only after Aditya has used the current merge enough to have strong opinions about how the stream should feel. |
| Time-travel via opLog scrubber | Visual history slider over opLog. Data is there; just UI work. |
| Context blocks as visible canvas fragments | Closes the "what does the model see" loop spatially. |
| Fork gesture (drag-with-modifier to spawn sibling) | Gestural branching. |
| Token-weight visualization | Color-tint fragments by token cost. |
| Style lenses / personas | Pre-configured system prompts per workspace. |
| Module docs in `docs/modules/` | Index is real now but content stubs remain. Candidates: `canvas-geometry.md`, `workspace.md`. |
| Markdown-in-single-swap-preview, caret-mid-markdown edge case | Hard for marginal value. Plain text + highlight is fine. |
| More drag-merge e2e | Physics positions vary; most stubs already skip gracefully. |
| Further `WorkspaceCanvas` split (`useFragmentDrag`, `useCanvasLayout`, `<FragmentCard>`) | 1630 LOC is still big but not hot. |
| Vision modes (C fidelity check, D style transfer, E concept extraction, B research, F compaction) | Roadmap items. None started. |
| Phase 0.5 cross-session intelligence | Roadmap deferred-state. |

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
