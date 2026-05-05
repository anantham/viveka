# Assertion proofs

Lightweight written proofs for invariants the codebase relies on — the kind of property that should not silently break. Each file cites specific code locations.

**Candidates worth writing now:**

- `oplog-append-only.md` — ADR-002 §F4 promises `Workspace.opLog` is append-only and thus replay-able. There's no test enforcing append-only-ness; verifying by inspection of all call sites is currently the only assurance.
- `merge-undoability.md` — `/api/tree/merge` stashes original source contents in `previousVersions` so `/api/tree/unmerge` can restore them. The invariant that every merge carries a complete pre-merge snapshot in the `Operation` log entry should be a small written proof.
- `fragment-hidden-after-merge.md` — A merged fragment removes its source fragments from `sequence`, `stageIds`, and renders them with a placeholder content. Together these three guarantee post-merge sources don't appear on canvas. Each guarantee is currently fragility-by-convention.

Empty for now.
