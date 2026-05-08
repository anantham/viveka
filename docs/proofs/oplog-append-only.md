# Proof: `Workspace.opLog` is append-only

**Last verified:** 2026-05-08
**Code hash:** `8ec551f`

## Assertion

`Workspace.opLog: Operation[]` is mutated in exactly one way at runtime: by appending new entries via `Array.prototype.push`. No call site removes, splices, slices-and-replaces, or filters out existing entries. This makes the log replay-able: every state at time `t` can be reconstructed by replaying ops `0..t-1`. ADR-002 §F4 promises this; this proof demonstrates it by inspection.

(Mutating fields *on existing op objects* — for example, the merge route patching `prompt`, `model`, `mergeType`, and `durationMs` onto its merge entry after the LLM call returns — is allowed. The op stays at the same index in the log. No previously-pushed op is ever removed.)

## Inspection

All references to `opLog` in source (excluding tests) — confirmed via:

```
grep -rn "opLog" src/lib src/app/api --include="*.ts" | grep -v __tests__
```

### Definition + initialization

- `src/lib/workspace.ts:186` — type declaration: `opLog: Operation[]`.
- `src/lib/workspace.ts:229` — initialized to `[]` in `createWorkspace()`.

### Append (push) sites — workspace ops

- `src/lib/workspace.ts:344` — `moveInSequence` pushes a `move` op.
- `src/lib/workspace.ts:362` — `moveToStage` pushes a `zone-transfer` op.
- `src/lib/workspace.ts:378` — `moveToWorkspace` pushes a `zone-transfer` op.
- `src/lib/workspace.ts:490` — `splitFragment` pushes a `split` op.
- `src/lib/workspace.ts:612` — `mergeFragments` pushes a `merge` op (with `preMergeSnapshot`).
- `src/lib/workspace.ts:735` — `unmergeFragments` pushes an `unmerge` op. **Note:** unmerge does NOT remove the matching `merge` op — both stay in the log.

### Append (push) sites — API routes

- `src/app/api/tree/generate/route.ts:154` — ephemeral `ai-generated` ops.
- `src/app/api/tree/generate/route.ts:208` — persisted `ai-generated` ops (one per fragment that completes).
- `src/app/api/tree/draft/route.ts:86` — single `draft` op per batch.
- `src/app/api/tree/reroll-phrase/route.ts:123` — ephemeral `reroll` op.
- `src/app/api/tree/reroll-phrase/route.ts:159` — persisted `reroll` op.
- `src/app/api/tree/swap-phrase/route.ts:65` — `swap-phrase` op (every code path).
- `src/app/api/expand/route.ts:76` — `expand` op.
- `src/app/api/tree/prune/route.ts:12` — `prune` op.
- `src/app/api/tree/prune/route.ts:15` — `restore` op.

### Patch sites — mutating fields on existing entries (allowed)

- `src/app/api/tree/merge/route.ts:76-79` — finds the merge op via `ws.opLog.find` and sets `op.prompt`, `op.model`, `op.mergeType`. Patches happen *before* `saveWorkspace` is called once. The op's index in the log is unchanged.
- `src/app/api/tree/merge/route.ts:101-104` — finds the same merge op after the LLM call returns and sets `op.durationMs`. Same shape: read existing, mutate fields, save.

These are the only non-push references to opLog. No call site assigns to `ws.opLog`, calls `.splice`, `.pop`, `.shift`, `.slice` followed by re-assignment, or `.filter` followed by re-assignment.

### Read-only sites

- `src/lib/workspace.ts:656-657` — `unmergeFragments` walks `ws.opLog` newest-to-oldest to find the matching `merge` entry. Read-only iteration; no mutation.

## Counter-examples checked

The following greps return zero hits in non-test code:

```
grep -rE "opLog *=|opLog\.(splice|pop|shift)|ws\.opLog *=" src --include="*.ts" --include="*.tsx" | grep -v __tests__
```

This rules out:
- Reassignment of `ws.opLog` to a new array.
- In-place removals (`pop`, `shift`, `splice`).

The single `ws.opLog[i]` index access at `src/lib/workspace.ts:657` is read-only (assigned to `const op`).

## Why this matters

- **Replay.** Any prior workspace state can be reconstructed by replaying ops `0..t-1` starting from `createWorkspace`. The X-ray (`ChatView.tsx`) relies on this implicitly by rendering the log in chronological order.
- **Unmerge correctness.** `unmergeFragments` searches the log for the matching `merge` op to recover the `preMergeSnapshot`. If a prior op were ever removed, snapshots could go missing and `unmerge` would degrade to a best-effort restore (per the `if (snapshot)` branch).
- **Audit trail.** Every LLM call, every gesture, every state mutation lives in the log. Removing any entry would create gaps in the X-ray that look like silent state changes.

## What would invalidate this

A future change adding any of:
- `ws.opLog = [...]` reassignment
- `ws.opLog.splice(...)` / `pop` / `shift`
- A "compaction" pass that rewrites the log to remove obsolete ops

would break the assertion. If such a change is contemplated, this proof needs an explicit amendment naming the new shape (e.g., "append-only modulo a documented compaction pass that preserves replay-ability").
