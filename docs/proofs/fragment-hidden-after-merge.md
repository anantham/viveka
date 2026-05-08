# Proof: source fragments hide from canvas after a merge

**Last verified:** 2026-05-08
**Code hash:** `8ec551f`

## Assertion

After `mergeFragments(ws, sourceId, targetId)` returns, neither `ws.fragments[sourceId]` nor `ws.fragments[targetId]` appears as a renderable card in `WorkspaceCanvas`. The fragments still exist in `ws.fragments` (so unmerge can find them and pop their `previousVersions`), but they are filtered out of every collection that drives canvas rendering.

This is *belt-and-suspenders*: three independent guarantees set by `mergeFragments` together produce the same visible outcome. Any one of them alone would suffice for the common path; together they're robust to filter-predicate changes.

## The three guarantees

`mergeFragments` (`src/lib/workspace.ts`) sets all three on both source and target before returning:

### G1 — Removed from `ws.sequence` and `ws.stageIds`

`src/lib/workspace.ts:565-595`. `nextSequence` is constructed by iterating `ws.sequence`: when the loop encounters `targetId` it pushes `mergedFrag.id`; when it encounters `sourceId` it skips (modulo a stage-only-source edge case). Then `ws.sequence = nextSequence` and `ws.stageIds = nextStageIds`. Both source and target are gone from sequence/stage; only `mergedFrag.id` is in their place.

### G2 — Content overwritten with `[merged into <id>]` placeholder

`src/lib/workspace.ts:608-610`:

```ts
sourceFrag.content = `[merged into ${mergedFrag.id}]`;
targetFrag.content = `[merged into ${mergedFrag.id}]`;
```

The original content has been pushed onto `previousVersions` two lines earlier (see `merge-undoability.md`); the live content is now the placeholder string.

### G3 — Status set to `pending`

`src/lib/workspace.ts:607,609`:

```ts
sourceFrag.status = "pending";
targetFrag.status = "pending";
```

## The three filter predicates

`WorkspaceCanvas.tsx` derives renderable fragment lists by filtering `ws.fragments`. Each list uses *one* of the three guarantees above to exclude post-merge sources:

### F1 — `sequenceFragments`

`src/components/loom/WorkspaceCanvas.tsx:357-360`:

```ts
const sequenceFragments = useMemo(
  () => ws.sequence.map((id) => ws.fragments[id]).filter((f): f is Fragment => !!f && f.provenance.type !== "system"),
  [ws.sequence, ws.fragments]
);
```

Only iterates `ws.sequence`. **Excludes post-merge sources via G1** (they're not in `ws.sequence` anymore).

### F2 — `stageFragments`

`src/components/loom/WorkspaceCanvas.tsx:362-365`:

```ts
const stageFragments = useMemo(
  () => ws.stageIds.map((id) => ws.fragments[id]).filter((f): f is Fragment => !!f),
  [ws.stageIds, ws.fragments]
);
```

Only iterates `ws.stageIds`. **Excludes post-merge sources via G1**.

### F3 — `unplacedFragments`

`src/components/loom/WorkspaceCanvas.tsx:372-380`:

```ts
const unplacedFragments = useMemo(() => {
  const inSeq = new Set(ws.sequence);
  const inStage = new Set(ws.stageIds);
  return Object.values(ws.fragments).filter(
    (f) => !inSeq.has(f.id) && !inStage.has(f.id) &&
      f.status === "complete" && f.content &&
      f.provenance.type !== "system" && !splitSourceIds.has(f.id)
  );
}, [ws.fragments, ws.sequence, ws.stageIds, splitSourceIds]);
```

This iterates *all* fragments (including the post-merge sources), so G1 alone wouldn't be enough. It excludes them via:
- **G3:** `f.status === "complete"` — sources have `status: "pending"`, so this drops them.
- **G2 indirectly:** the placeholder string `"[merged into ...]"` is non-empty, so the `f.content` truthy check doesn't catch it. G2 alone would NOT suffice for this filter; it's a secondary signal that becomes load-bearing for the `[merged into …]` text rendering (so the "alts hidden" badge doesn't expose them).

### F4 — `generatingFragments`

`src/components/loom/WorkspaceCanvas.tsx:382-385`:

```ts
const generatingFragments = useMemo(
  () => Object.values(ws.fragments).filter((f) => f.status === "generating"),
  [ws.fragments]
);
```

**Excludes post-merge sources via G3 (inverted):** `status === "pending"` ≠ `"generating"`. The merged fragment itself, however, IS in this list (status `"generating"` while the LLM runs).

### `allVisible` = union of the four

`src/components/loom/WorkspaceCanvas.tsx:414-422`:

```ts
const allVisible = useMemo(() => {
  const seen = new Map<string, Fragment>();
  for (const f of sequenceFragments) seen.set(f.id, f);
  for (const f of stageFragments) seen.set(f.id, f);
  for (const f of generatingFragments) seen.set(f.id, f);
  return Array.from(seen.values());
}, [sequenceFragments, stageFragments, generatingFragments]);
```

Note `unplacedFragments` is NOT in `allVisible`. Unplaced alts only appear via the explicit "N alts" browser overlay that the user opens.

## Why this works

The post-merge source fragments have:
- `status === "pending"` (G3) — fails F4's `status === "generating"` check.
- Not in `ws.sequence` (G1) — fails F1.
- Not in `ws.stageIds` (G1) — fails F2.
- Status not `"complete"` (G3) — fails F3.

So they're filtered out of every list that feeds `allVisible` AND out of `unplacedFragments` (which feeds the alts browser). Net effect: invisible everywhere.

## What would invalidate this

A future change that:
- Removes G1 (e.g., `mergeFragments` keeps source/target in `ws.sequence`) — F1 and F2 would start including them; the post-merge canvas would show duplicate cards.
- Removes G2 (sources keep their original content) — visually confusing; merge would be cosmetic only. F3 still hides them via G3.
- Removes G3 (sources keep `status: "complete"`) — F3 starts including them as unplaced alts; F4 doesn't change. They'd appear as orphan alternatives in the "N alts" browser.
- Adds a new filter predicate that uses *only* G2 (e.g., `f.content && !f.content.startsWith("[merged into")`) — fragile if the placeholder string changes; recommend predicates use G1 or G3 instead.

The unit tests in `src/lib/__tests__/workspace-merge.test.ts` exercise the merge state directly (status, content, sequence membership) but don't exercise the canvas render paths. The e2e suite implicitly verifies the visual outcome (no duplicate cards after merge).
