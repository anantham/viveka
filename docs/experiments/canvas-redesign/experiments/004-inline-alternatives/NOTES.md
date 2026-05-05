# Experiment D — Inline alternatives during reroll

## v2 (2026-05-05) — In-place preview, no duplicates

**Aditya's feedback after testing v1:** *"I want to see a spinner with a small countdown so I know what the eta to see the options. AND I do not want new nodes — I want the selected text to change color and small 1/3 so I can use arrows to cycle through the phrases and see how it looks in context. Right now it just makes duplicates and it's a pain to move around."*

**Diagnosis:** v1's panel-with-derived-siblings approach was fundamentally wrong. Three problems:
- Panel sat below the fragment competing with the writing surface.
- API created 5 derived sibling fragments (one per alternative). They were "alts hidden" on canvas but cluttered tree view + workspace data.
- No in-context preview — alternatives shown as separate text rows, not in their actual surrounding sentence.

**v2 design (what Aditya described and got built):**
- API gains an `ephemeral: true` mode (now the default) that returns just the alternative phrase strings without writing siblings. Workspace stays clean.
- The *source fragment's text* now renders with the original phrase swapped for the current alternative, color-highlighted (violet bg) in place. The writer sees the alternative IN context.
- A tiny badge floats above the fragment: pending = `● 1.3s · ~12s`, preview = `← 1/5 → ↵ pick · esc revert`, committing = `committing…`.
- ArrowLeft / ArrowRight (and Up/Down/Tab) cycle through alternatives.
- Enter commits via `/api/tree/edit` (in-place edit on the source fragment — no new nodes).
- Esc reverts to original — badge disappears, fragment back to its original text, alternatives discarded entirely.

**Files added/changed (v2 on top of v1):**
- `src/app/api/tree/reroll-phrase/route.ts` — new `ephemeral?: boolean` body field; returns `{alternatives: string[]}`. Persisted mode kept for backward-compat. Prompt rewritten to ask for just the N replacement phrases (not full re-renders).
- `src/components/loom/LoomInterface.tsx` — `handleReplace` now uses `ephemeral: true` and returns alternatives; new `handleCommitPhraseEdit` calls `/api/tree/edit`.
- `src/components/loom/WorkspaceCanvas.tsx`:
  - New module-level `InlineRerollBadge` component.
  - `inlineAlts` state shape changed: tracks `alternatives: string[]` and `currentIdx` instead of `siblingIds`.
  - Replace button click handler captures `charStart`/`charEnd`, enters pending state, awaits ephemeral API, transitions to preview.
  - FULL render path now substitutes the source fragment's text with the current alternative when this fragment is the active source.
  - Keyboard effect: arrow keys cycle, Enter commits, Esc dismisses.
  - Old big-panel render block removed.
- `src/components/loom/InlineAlternativesPanel.tsx` — kept on disk (unused for reroll path; potentially reusable for the deferred extend path).

**Verified screenshots:** `005-inline-pending.png`, `005-inline-preview.png`, `005-inline-cycle-2.png`, `005-inline-cycle-3.png`, `005-inline-after-esc.png` — full flow works end-to-end. Esc leaves zero residue (no new fragments, no new edges, original content restored).

**Known follow-on:** the model sometimes returns alternatives that include the original phrase ("intentional friction" as an alternative for "friction"). Prompt-engineering issue, not UX. Easy to iterate on by tightening the system prompt.

---

## v1 (2026-05-04) — Panel-with-siblings (deprecated by v2)


**Status:** ✅ MVP done (reroll path; extend path deferred)
**Branch:** `exp/phase-transition-canvas`
**Time:** ~50 min
**Trigger:** Aditya's live testing — "when I select some text chunk and click replace I dont see any loader, spinner that indicates some API call is pending and I will get to see options for say inline filling"

## Diagnosis (the bug Aditya found)

Three things were wrong with the existing replace flow:

1. **`/api/tree/reroll-phrase` is synchronous.** Unlike `/api/tree/draft` and `/api/tree/generate` which return pending IDs and use background polling, reroll-phrase blocks for 5–15s while Claude generates 5 alternatives, then returns all at once.
2. **No UI feedback during the await.** `LoomInterface.handleReplace` just `await`d the fetch. The toolbar dismissed instantly; nothing visible until the response arrived; then the canvas just refreshed.
3. **Alternatives ARE created but hidden.** The 5 sibling fragments land in `ws.fragments` with provenance type `derived`. They're "unplaced," and Experiment A's vision-driven decision was to hide unplaced fragments on canvas. So they only showed up in tree view — invisible from the writing surface.

## What landed

### The pending state

The moment "replace" is clicked, an `InlineAlternativesPanel` appears below the source fragment showing:

- Spinner + "GENERATING ALTERNATIVES" headline
- The selected phrase quoted ("for 'friction'")
- Live elapsed counter and ETA (`1.2s · ~12s`)
- Heuristic progress bar capped at the empirical typical wall time (12s)
- "Esc to cancel" hint

Now the user knows *something* is happening and roughly how long.

### The ready state

Once the API returns, the panel transitions to a list of N alternatives:

- Header: `5 ALTERNATIVES FOR "FRICTION"  ↑↓ navigate · Enter pick · Esc dismiss`
- One row per alternative, color-stripe per index (emerald / violet / amber / rose / cyan).
- Each row shows the original sentence with the phrase that changed highlighted: `…tweet about how AI tools need more **resistance**, not more features…`
- The first row is focused by default; arrow keys move focus; Enter or click commits.

### Commit and dismiss

- **Pick** (click or Enter): calls `/api/tree/select` with the chosen sibling id, which swaps that sibling into the sequence in place of the original phrase fragment. Original becomes a derived sibling (still in tree view if user wants to revisit). Other unpicked alternatives also remain as derived siblings.
- **Dismiss** (Esc): clears the panel without committing. All 5 alternatives remain in `ws.fragments` as derived siblings — visible in tree view, hidden from canvas per the vision.

The original split-toolbar's "split" button still works as before.

## Files touched

- `src/components/loom/LoomInterface.tsx`:
  - `handleReplace` now returns `Promise<{siblingNodeIds: string[]} | null>` instead of void, so the caller can await and react to the result.
  - New `handleSelectFragmentSibling` — calls `/api/tree/select` to swap a sibling into the sequence.
  - Both new props wired through to `WorkspaceCanvas`.
- `src/components/loom/WorkspaceCanvas.tsx`:
  - `onReplace` prop signature now Promise-returning.
  - New `onSelectFragmentSibling?` prop.
  - New `inlineAlts` state: `{sourceId, state: "pending" | "ready" | "committing", startedAt, siblingIds, selectedText}`.
  - "replace" button click handler now sets pending state, awaits onReplace, transitions to ready or clears.
  - New render block after merge spinner: `<InlineAlternativesPanel ... />` anchored below the source fragment.
- `src/components/loom/InlineAlternativesPanel.tsx` (new file, ~200 LOC):
  - Three render variants (pending / committing / ready).
  - Spinner component.
  - `inferPhraseDiff` heuristic: aligns prefix/suffix common substrings to extract the changed phrase.
  - Keyboard handlers: ↑↓ ArrowUp/ArrowDown move focus, Enter/Tab commit, Esc dismiss.
  - GHOST_COLORS per-index palette.

## What's still off / deferred

- **Original fragment doesn't fade during the panel.** Could dim it to 0.4 opacity to focus eye on alternatives. Polish.
- **Extend path not wired.** "Extend" (continue from cursor) currently calls `/api/tree/draft` and shows the alternatives only via tree view — same gap. Adding inline-ghost rendering for extend should reuse the same `InlineAlternativesPanel` with a different anchor point. Est. ~30 min.
- **No keyboard shortcut on the source fragment.** Currently you have to select text → click replace. A keyboard shortcut (e.g., Cmd+R when text is selected) would feel more wizard-ish. Polish.
- **Phrase diff is heuristic.** When the model returns a substantial rewrite (not just a phrase swap), the prefix/suffix alignment over-includes the change. Acceptable for v1.
- **Commit is destructive of original.** When you pick option 1 ("resistance"), the original fragment leaves the sequence and becomes a derived sibling. Tree view still has it. If Aditya wants the original to stay accessible from canvas (as it would in a true wizard's-undo flow), we'd need separate state.

## Before / after

- `pending.png` — moment after click. Spinner, "1.2s · ~12s", "for 'friction'".
- `ready.png` — 5 alternatives shown with phrase-diff highlights and ghost-color stripes.

## Design notes

The vision quote that anchors this:

> "if I'm doing inline replays or extensions, it's like a zoomed in part of the tree, you know, I'm not seeing the full picture but I'm seeing with a different color the potential phrases that could complete or replace that span or continue writing from there here which I selected."

The panel is exactly that — a local zoomed-in tree view, ephemeral, anchored to the selected span. Five color-coded leaves, you pick one and the rest fade. Tree view is for when you want the whole picture; the inline panel is for the operation.
