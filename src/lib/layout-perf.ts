// Layout performance observability
// Measures DOM measurement costs to empirically decide if Pretext is needed

export interface LayoutMeasurement {
  timestamp: number;
  operation: "measure-heights" | "flip-snapshot" | "flip-apply" | "full-transition";
  nodeCount: number;
  durationMs: number;
  details?: Record<string, number>; // per-node timings if needed
}

// Ring buffer of recent measurements
const MAX_MEASUREMENTS = 200;
const measurements: LayoutMeasurement[] = [];

export function recordMeasurement(m: LayoutMeasurement): void {
  measurements.push(m);
  if (measurements.length > MAX_MEASUREMENTS) {
    measurements.shift();
  }
}

export function getMeasurements(): LayoutMeasurement[] {
  return [...measurements];
}

export function clearMeasurements(): void {
  measurements.length = 0;
}

/**
 * Summary stats for a given operation type.
 */
export function getStats(operation?: LayoutMeasurement["operation"]): {
  count: number;
  avgMs: number;
  maxMs: number;
  p95Ms: number;
  avgNodesPerOp: number;
} | null {
  const filtered = operation
    ? measurements.filter((m) => m.operation === operation)
    : measurements;

  if (filtered.length === 0) return null;

  const durations = filtered.map((m) => m.durationMs).sort((a, b) => a - b);
  const sum = durations.reduce((a, b) => a + b, 0);
  const nodeSum = filtered.reduce((a, m) => a + m.nodeCount, 0);
  const p95Idx = Math.floor(durations.length * 0.95);

  return {
    count: filtered.length,
    avgMs: sum / filtered.length,
    maxMs: durations[durations.length - 1],
    p95Ms: durations[p95Idx],
    avgNodesPerOp: nodeSum / filtered.length,
  };
}

/**
 * Convenience: time a block and record it.
 */
export function timedMeasure<T>(
  operation: LayoutMeasurement["operation"],
  nodeCount: number,
  fn: () => T
): T {
  const start = performance.now();
  const result = fn();
  const durationMs = performance.now() - start;
  recordMeasurement({ timestamp: Date.now(), operation, nodeCount, durationMs });
  return result;
}

/**
 * Async version.
 */
export async function timedMeasureAsync<T>(
  operation: LayoutMeasurement["operation"],
  nodeCount: number,
  fn: () => Promise<T>
): Promise<T> {
  const start = performance.now();
  const result = await fn();
  const durationMs = performance.now() - start;
  recordMeasurement({ timestamp: Date.now(), operation, nodeCount, durationMs });
  return result;
}

/**
 * Get a human-readable report.
 */
export function getReport(): string {
  const ops: LayoutMeasurement["operation"][] = [
    "measure-heights",
    "flip-snapshot",
    "flip-apply",
    "full-transition",
  ];

  const lines = ["=== Layout Performance Report ===", ""];

  for (const op of ops) {
    const stats = getStats(op);
    if (!stats) continue;
    lines.push(`${op}:`);
    lines.push(`  samples: ${stats.count}`);
    lines.push(`  avg: ${stats.avgMs.toFixed(2)}ms`);
    lines.push(`  max: ${stats.maxMs.toFixed(2)}ms`);
    lines.push(`  p95: ${stats.p95Ms.toFixed(2)}ms`);
    lines.push(`  avg nodes: ${stats.avgNodesPerOp.toFixed(1)}`);
    lines.push("");
  }

  const total = getStats();
  if (total) {
    lines.push(`all operations:`);
    lines.push(`  total samples: ${total.count}`);
    lines.push(`  avg: ${total.avgMs.toFixed(2)}ms`);
    lines.push(`  max: ${total.maxMs.toFixed(2)}ms`);
    lines.push(`  p95: ${total.p95Ms.toFixed(2)}ms`);

    // Verdict
    lines.push("");
    if (total.p95Ms > 8) {
      lines.push(`VERDICT: p95 > 8ms — DOM measurement is a bottleneck.`);
      lines.push(`  Consider Pretext for pre-computation.`);
    } else if (total.p95Ms > 4) {
      lines.push(`VERDICT: p95 4-8ms — borderline. Monitor as node count grows.`);
    } else {
      lines.push(`VERDICT: p95 < 4ms — DOM measurement is fast enough.`);
      lines.push(`  Pretext not needed at current scale.`);
    }
  }

  return lines.join("\n");
}
