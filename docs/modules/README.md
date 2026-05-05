# Module docs

One-page deep-dives for behavioural primitives in `src/lib/` and `src/hooks/` that encode subtle logic worth documenting in plain English. Empty for now — populate as the underlying modules stabilise. Candidates currently:

- `src/lib/heuristics.ts` — anthropomorphic regex tables, abstraction-level scoring (thresholds are tuned, deserves a "why" doc).
- `src/lib/canvas-utils.ts` — coordinate math used across canvas views.
- `src/hooks/usePhysicsSimulation.ts` — repulsion / spring / merge-collision tuning.
- `src/lib/intervention-log.ts` — pattern-flag aggregation rules.

Format suggestion per module: a single Markdown file at `docs/modules/<filename>.md` with sections: *what it does*, *what calls it*, *what it depends on*, *invariants*, *known limitations*, *recent decisions*.
