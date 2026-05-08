# Assertion proofs

Lightweight written proofs for invariants the codebase relies on — the kind of property that should not silently break. Each file cites specific code locations and lists what would invalidate it.

## Current proofs

- **[oplog-append-only.md](./oplog-append-only.md)** — `Workspace.opLog` is append-only at runtime. Mutating fields on existing op objects is allowed; removing or reordering entries is not. Replay-ability and audit-trail integrity rely on this.
- **[merge-undoability.md](./merge-undoability.md)** — every merge can be reversed via unmerge. Three pieces of state captured at merge time make the round-trip work: `previousVersions` (content stash), `preMergeSnapshot` (sequence/stage indices), and the `merge` opLog entry that carries the snapshot.
- **[fragment-hidden-after-merge.md](./fragment-hidden-after-merge.md)** — post-merge source fragments don't render on canvas. Three independent guarantees (removed from `sequence`/`stageIds`, content overwritten, `status: pending`) plus four filter predicates that each catch sources via at least one of the guarantees.

## When to write a new proof

If a code change relies on an invariant that:
1. Spans multiple files / modules / commits, AND
2. Has no direct test enforcing it (or the tests are incidental coverage), AND
3. Would silently corrupt state if violated,

write a proof. The proof's value is in *naming* the invariant so future changes can be evaluated against it.
