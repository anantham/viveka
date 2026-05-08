# Proof: every merge can be reversed via unmerge

**Last verified:** 2026-05-08
**Code hash:** `8ec551f`

## Assertion

For every fragment created by `mergeFragments(ws, sourceId, targetId)`, calling `unmergeFragments(ws, mergedFrag.id)` afterward restores:

1. **Source content** — `ws.fragments[sourceId].content` and `ws.fragments[targetId].content` return to their pre-merge values.
2. **Sequence position** — if a source was in `ws.sequence` before the merge, it is back in `ws.sequence` after the unmerge, in its original relative order.
3. **Stage membership** — if a source was in `ws.stageIds` before the merge, it is back in `ws.stageIds` after the unmerge.
4. **Merged fragment removal** — `ws.fragments[mergedFragId]` is deleted, along with its derivation edges and canvas position.

This is the round-trip invariant exercised by `src/lib/__tests__/workspace-merge.test.ts → "merge → unmerge round-trip"` and by `src/app/api/tree/__tests__/merge-route.test.ts → "merge → unmerge round-trip restores sources"`. The proof here documents *why* the round-trip works, citing the structural guarantees that make it possible.

## Mechanism

The round-trip relies on three pieces of state captured by `mergeFragments` at merge time:

### A. Original content stashed in `previousVersions`

`src/lib/workspace.ts:605-606`:

```ts
sourceFrag.previousVersions.push(sourceFrag.content);
targetFrag.previousVersions.push(targetFrag.content);
sourceFrag.status = "pending";
sourceFrag.content = `[merged into ${mergedFrag.id}]`;
targetFrag.status = "pending";
targetFrag.content = `[merged into ${mergedFrag.id}]`;
```

Both source and target push their original content onto `previousVersions` *before* the content is overwritten with the placeholder. `unmergeFragments` pops from `previousVersions` to restore (`src/lib/workspace.ts:670`):

```ts
src.content = src.previousVersions.pop()!;
src.status = "complete";
```

Because `previousVersions` is a stack and `unmerge` pops in reverse order, repeated merge→unmerge round-trips don't lose history (an earlier human edit in `previousVersions[0]` is preserved underneath the merge stash at `previousVersions[1]`).

### B. Pre-merge sequence/stage membership in `preMergeSnapshot`

`src/lib/workspace.ts:557-563`, *captured before* the sequence is mutated:

```ts
const sourceInSequence = ws.sequence.includes(sourceId);
const sourceInStage = ws.stageIds.includes(sourceId);
const targetInSequence = ws.sequence.includes(targetId);
const targetInStage = ws.stageIds.includes(targetId);
const preSourceSeqIdx = ws.sequence.indexOf(sourceId);
const preTargetSeqIdx = ws.sequence.indexOf(targetId);
```

**Critical:** these reads happen *before* `ws.sequence = nextSequence` at line 593. Reading after the mutation would return `-1` for both indices (since both source and target have been replaced by `mergedFrag.id` in the new sequence). This was a real bug fixed earlier; the regression test is `src/lib/__tests__/workspace-merge.test.ts → "captures TRUE pre-mutation sequence indices (not -1)"`.

The snapshot rides along on the merge op (`src/lib/workspace.ts:617-624`):

```ts
ws.opLog.push({
  type: "merge",
  sourceIds: [sourceId, targetId],
  resultId: mergedFrag.id,
  timestamp: startedAtIso,
  preMergeSnapshot: {
    sourceWasInSequence,
    targetWasInSequence,
    sourceWasInStage,
    targetWasInStage,
    preSourceSeqIdx,
    preTargetSeqIdx,
  },
});
```

`unmergeFragments` retrieves it by walking `ws.opLog` newest-to-oldest until the matching merge entry is found (`src/lib/workspace.ts:653-660`).

### C. Restoration ordered by recorded indices

`src/lib/workspace.ts:686-696`:

```ts
const seqRestorations: string[] = [];
if (snapshot) {
  const ordered = [...sourceIds].sort((a, b) => {
    const idxA = a === sourceIds[0] ? snapshot!.preSourceSeqIdx : snapshot!.preTargetSeqIdx;
    const idxB = b === sourceIds[0] ? snapshot!.preSourceSeqIdx : snapshot!.preTargetSeqIdx;
    return idxA - idxB;
  });
  for (const id of ordered) {
    if (wasInSequence(id) && ws.fragments[id]) seqRestorations.push(id);
  }
}
```

The two source IDs are sorted by their recorded original indices (smaller first), and only those that were actually in `ws.sequence` pre-merge get included. The result is then spliced into the sequence at the merged-id slot:

`src/lib/workspace.ts:712-714`:

```ts
const mergedSeqIdx = ws.sequence.indexOf(mergedId);
if (mergedSeqIdx !== -1) {
  ws.sequence.splice(mergedSeqIdx, 1, ...seqRestorations);
}
```

Stage restoration is symmetric (lines 704-728).

### D. Merged fragment + edges + canvas position cleared

`src/lib/workspace.ts:731-733`:

```ts
delete ws.fragments[mergedId];
ws.edges = ws.edges.filter((e) => e.from !== mergedId && e.to !== mergedId);
delete ws.canvasPositions[mergedId];
```

The merged fragment vanishes from every canonical structure. Note that the `merge` op stays in the log — opLog is append-only (see `oplog-append-only.md`); `unmerge` adds a NEW `unmerge` entry, it doesn't remove the matching `merge`.

## Round-trip property

Together, A + B + C + D give:

- **Content:** A.push at merge → A.pop at unmerge → original strings restored.
- **Sequence:** B records pre-mutation indices → C uses them to re-splice in original order. The merged fragment occupies one slot; restoring it expands that slot to the original 0/1/2 source ids.
- **Stage:** symmetric to sequence.
- **Merged fragment:** D deletes it. The `merge` op log entry stays for audit; a new `unmerge` op is appended.

## Test coverage

- `src/lib/__tests__/workspace-merge.test.ts` (22 tests)
  - "merge → unmerge round-trip" — content + sequence + fragment removal
  - "captures TRUE pre-mutation sequence indices" — regression for the snapshot-after-mutation bug
  - "restores in REVERSE order when target preceded source pre-merge" — uses snapshot indices
  - "restores only the source that was originally in sequence (other was staged)" — exercises wasInSequence/wasInStage flags
- `src/app/api/tree/__tests__/merge-route.test.ts → "merge → unmerge round-trip restores sources"` — same property at the route level (via real fetch handlers + mocked store/LLM).

## What would invalidate this

A future change that:
- Removes the `previousVersions.push` before content overwrite — content recovery breaks.
- Reads `preSourceSeqIdx` / `preTargetSeqIdx` *after* `ws.sequence = nextSequence` — both indices become -1 (the original bug; regression test catches this).
- Compacts the opLog and removes a `merge` entry — `unmergeFragments` falls back to the `if (snapshot)` else branch, losing position fidelity.
- Removes the `wasInSequence`/`wasInStage` filtering — sources that were originally only-staged get duplicated into both sequence and stage on restore.

The unit tests above exercise each of these paths; any regression should fail at least one.
