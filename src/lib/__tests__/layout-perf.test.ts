import { describe, it, expect, beforeEach } from "vitest";
import {
  recordMeasurement,
  getMeasurements,
  clearMeasurements,
  getStats,
  timedMeasure,
  getReport,
} from "../layout-perf";

beforeEach(() => {
  clearMeasurements();
});

describe("recordMeasurement", () => {
  it("records and retrieves measurements", () => {
    recordMeasurement({
      timestamp: 1000,
      operation: "measure-heights",
      nodeCount: 5,
      durationMs: 2.5,
    });

    const measurements = getMeasurements();
    expect(measurements).toHaveLength(1);
    expect(measurements[0].operation).toBe("measure-heights");
    expect(measurements[0].durationMs).toBe(2.5);
  });

  it("caps at 200 measurements (ring buffer)", () => {
    for (let i = 0; i < 250; i++) {
      recordMeasurement({
        timestamp: i,
        operation: "flip-snapshot",
        nodeCount: 1,
        durationMs: i,
      });
    }

    const measurements = getMeasurements();
    expect(measurements).toHaveLength(200);
    // First entry should be #50 (oldest 50 were evicted)
    expect(measurements[0].timestamp).toBe(50);
  });
});

describe("clearMeasurements", () => {
  it("empties all measurements", () => {
    recordMeasurement({
      timestamp: 1,
      operation: "measure-heights",
      nodeCount: 1,
      durationMs: 1,
    });
    clearMeasurements();
    expect(getMeasurements()).toHaveLength(0);
  });
});

describe("getMeasurements", () => {
  it("returns a copy, not the original array", () => {
    recordMeasurement({
      timestamp: 1,
      operation: "flip-apply",
      nodeCount: 1,
      durationMs: 1,
    });
    const a = getMeasurements();
    const b = getMeasurements();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe("getStats", () => {
  it("returns null for no measurements", () => {
    expect(getStats()).toBeNull();
    expect(getStats("measure-heights")).toBeNull();
  });

  it("computes correct stats for a single measurement", () => {
    recordMeasurement({
      timestamp: 1,
      operation: "measure-heights",
      nodeCount: 10,
      durationMs: 5,
    });

    const stats = getStats("measure-heights");
    expect(stats).not.toBeNull();
    expect(stats!.count).toBe(1);
    expect(stats!.avgMs).toBe(5);
    expect(stats!.maxMs).toBe(5);
    expect(stats!.p95Ms).toBe(5);
    expect(stats!.avgNodesPerOp).toBe(10);
  });

  it("computes correct stats across multiple measurements", () => {
    const durations = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    for (const d of durations) {
      recordMeasurement({
        timestamp: d,
        operation: "flip-snapshot",
        nodeCount: 5,
        durationMs: d,
      });
    }

    const stats = getStats("flip-snapshot");
    expect(stats!.count).toBe(10);
    expect(stats!.avgMs).toBe(5.5);
    expect(stats!.maxMs).toBe(10);
    expect(stats!.p95Ms).toBe(10); // index 9 of 10
    expect(stats!.avgNodesPerOp).toBe(5);
  });

  it("filters by operation type", () => {
    recordMeasurement({
      timestamp: 1,
      operation: "measure-heights",
      nodeCount: 3,
      durationMs: 2,
    });
    recordMeasurement({
      timestamp: 2,
      operation: "flip-apply",
      nodeCount: 3,
      durationMs: 8,
    });

    const heightStats = getStats("measure-heights");
    expect(heightStats!.count).toBe(1);
    expect(heightStats!.avgMs).toBe(2);

    const flipStats = getStats("flip-apply");
    expect(flipStats!.count).toBe(1);
    expect(flipStats!.avgMs).toBe(8);
  });

  it("returns all stats when no operation filter", () => {
    recordMeasurement({
      timestamp: 1,
      operation: "measure-heights",
      nodeCount: 3,
      durationMs: 2,
    });
    recordMeasurement({
      timestamp: 2,
      operation: "flip-apply",
      nodeCount: 3,
      durationMs: 8,
    });

    const allStats = getStats();
    expect(allStats!.count).toBe(2);
    expect(allStats!.avgMs).toBe(5);
  });
});

describe("timedMeasure", () => {
  it("times a synchronous function and records it", () => {
    const result = timedMeasure("measure-heights", 3, () => {
      // Simulate some work
      let sum = 0;
      for (let i = 0; i < 1000; i++) sum += i;
      return sum;
    });

    expect(result).toBe(499500);

    const measurements = getMeasurements();
    expect(measurements).toHaveLength(1);
    expect(measurements[0].operation).toBe("measure-heights");
    expect(measurements[0].nodeCount).toBe(3);
    expect(measurements[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns the function's return value", () => {
    const result = timedMeasure("flip-snapshot", 1, () => "hello");
    expect(result).toBe("hello");
  });
});

describe("getReport", () => {
  it("produces a report string", () => {
    recordMeasurement({
      timestamp: 1,
      operation: "measure-heights",
      nodeCount: 10,
      durationMs: 2,
    });
    recordMeasurement({
      timestamp: 2,
      operation: "full-transition",
      nodeCount: 10,
      durationMs: 350,
    });

    const report = getReport();
    expect(report).toContain("Layout Performance Report");
    expect(report).toContain("measure-heights");
    expect(report).toContain("full-transition");
    expect(report).toContain("VERDICT");
  });

  it("gives green verdict when p95 < 4ms", () => {
    recordMeasurement({
      timestamp: 1,
      operation: "measure-heights",
      nodeCount: 5,
      durationMs: 1.5,
    });

    const report = getReport();
    expect(report).toContain("Pretext not needed");
  });

  it("gives red verdict when p95 > 8ms", () => {
    for (let i = 0; i < 5; i++) {
      recordMeasurement({
        timestamp: i,
        operation: "measure-heights",
        nodeCount: 50,
        durationMs: 12,
      });
    }

    const report = getReport();
    expect(report).toContain("Consider Pretext for pre-computation");
  });
});
