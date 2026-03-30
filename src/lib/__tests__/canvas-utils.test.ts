import { describe, it, expect } from "vitest";
import {
  computeReadingOrder,
  isInContext,
  computeColumnPositions,
  computeDefaultPositions,
  cycleTool,
  computeGhostPosition,
  computePathPoints,
  buildPathD,
  CursorTool,
  NodePositions,
} from "../canvas-utils";

// --- computeReadingOrder ---

describe("computeReadingOrder", () => {
  it("sorts by Y position (primary)", () => {
    const positions: NodePositions = {
      a: { x: 100, y: 300 },
      b: { x: 100, y: 100 },
      c: { x: 100, y: 200 },
    };
    expect(computeReadingOrder(["a", "b", "c"], positions)).toEqual(["b", "c", "a"]);
  });

  it("tiebreaks by X (left to right) when Y is within threshold", () => {
    const positions: NodePositions = {
      a: { x: 300, y: 100 },
      b: { x: 100, y: 105 }, // within 20px Y threshold
      c: { x: 200, y: 98 },
    };
    expect(computeReadingOrder(["a", "b", "c"], positions)).toEqual(["b", "c", "a"]);
  });

  it("treats Y differences > 20px as different rows", () => {
    const positions: NodePositions = {
      a: { x: 500, y: 100 },
      b: { x: 100, y: 125 }, // 25px difference, different row
    };
    expect(computeReadingOrder(["a", "b"], positions)).toEqual(["a", "b"]);
  });

  it("filters out nodes without positions", () => {
    const positions: NodePositions = {
      a: { x: 100, y: 100 },
    };
    expect(computeReadingOrder(["a", "b", "c"], positions)).toEqual(["a"]);
  });

  it("returns empty array for empty input", () => {
    expect(computeReadingOrder([], {})).toEqual([]);
  });

  it("handles single node", () => {
    const positions: NodePositions = { a: { x: 0, y: 0 } };
    expect(computeReadingOrder(["a"], positions)).toEqual(["a"]);
  });

  it("does not mutate the input array", () => {
    const ids = ["c", "a", "b"];
    const positions: NodePositions = {
      a: { x: 0, y: 0 },
      b: { x: 0, y: 100 },
      c: { x: 0, y: 200 },
    };
    computeReadingOrder(ids, positions);
    expect(ids).toEqual(["c", "a", "b"]);
  });
});

// --- isInContext ---

describe("isInContext", () => {
  const columnCenter = 500;

  it("returns true when node center is within column", () => {
    // node at x=300, width=400, center=500 → exactly at column center
    expect(isInContext(300, 400, columnCenter)).toBe(true);
  });

  it("returns true when node is near the column edge", () => {
    // node center at 500 + 200 = 700, within default half-width 250
    expect(isInContext(500, 400, columnCenter)).toBe(true);
  });

  it("returns false when node is far from column", () => {
    // node at x=0, width=100, center=50 → 450px from column center
    expect(isInContext(0, 100, columnCenter)).toBe(false);
  });

  it("respects custom column half-width", () => {
    // node center at 600, column center 500, half-width 50 → 100px away, out
    expect(isInContext(400, 400, columnCenter, 50)).toBe(false);
    // same but with wider column
    expect(isInContext(400, 400, columnCenter, 150)).toBe(true);
  });

  it("handles edge case at exact boundary", () => {
    // node center at 750, column center 500, half-width 250 → exactly at boundary
    // Math.abs(750 - 500) = 250, which is NOT < 250, so false
    expect(isInContext(550, 400, columnCenter, 250)).toBe(false);
  });
});

// --- computeColumnPositions ---

describe("computeColumnPositions", () => {
  it("stacks nodes vertically centered on column", () => {
    const positions = computeColumnPositions(
      ["a", "b", "c"],
      500,  // columnCenterX
      400,  // nodeWidth
      { a: 60, b: 80, c: 40 },
      0,    // startY
      10    // spacing
    );

    expect(positions.a).toEqual({ x: 300, y: 0 });       // centered: 500 - 400/2
    expect(positions.b).toEqual({ x: 300, y: 70 });       // 0 + 60 + 10
    expect(positions.c).toEqual({ x: 300, y: 160 });      // 70 + 80 + 10
  });

  it("uses fallback height when not measured", () => {
    const positions = computeColumnPositions(
      ["a", "b"],
      500,
      400,
      {},    // no measured heights
      0,
      10
    );

    expect(positions.a).toEqual({ x: 300, y: 0 });
    expect(positions.b).toEqual({ x: 300, y: 90 }); // 0 + 80 (fallback) + 10
  });

  it("returns empty for empty input", () => {
    expect(computeColumnPositions([], 500)).toEqual({});
  });
});

// --- computeDefaultPositions ---

describe("computeDefaultPositions", () => {
  it("places nodes in column layout centered on canvas", () => {
    const positions = computeDefaultPositions(["a", "b"], 1000, 480);
    // column center = 500, x = 500 - 240 = 260
    expect(positions.a.x).toBe(260);
    expect(positions.b.x).toBe(260);
    expect(positions.b.y).toBeGreaterThan(positions.a.y);
  });
});

// --- cycleTool ---

describe("cycleTool", () => {
  it("cycles forward: select → tangent → hand → select", () => {
    expect(cycleTool("select", 1)).toBe("tangent");
    expect(cycleTool("tangent", 1)).toBe("hand");
    expect(cycleTool("hand", 1)).toBe("select");
  });

  it("cycles backward: select → hand → tangent → select", () => {
    expect(cycleTool("select", -1)).toBe("hand");
    expect(cycleTool("hand", -1)).toBe("tangent");
    expect(cycleTool("tangent", -1)).toBe("select");
  });
});

// --- computeGhostPosition ---

describe("computeGhostPosition", () => {
  it("places ghost below last node in reading order", () => {
    const positions: NodePositions = {
      a: { x: 100, y: 0 },
      b: { x: 100, y: 100 },
    };
    const heights = { a: 50, b: 60 };

    const ghost = computeGhostPosition(["a", "b"], positions, heights);
    // Below node b: y=100 + height=60 + spacing=20 + 10 = 190
    expect(ghost.x).toBe(100);
    expect(ghost.y).toBe(190);
  });

  it("returns default position for empty reading order", () => {
    const ghost = computeGhostPosition([], {}, {});
    expect(ghost).toEqual({ x: 0, y: 40 }); // DEFAULT_START_Y
  });

  it("uses fallback height when not measured", () => {
    const positions: NodePositions = { a: { x: 50, y: 10 } };
    const ghost = computeGhostPosition(["a"], positions, {});
    // y=10 + 80 (fallback) + 20 + 10 = 120
    expect(ghost.y).toBe(120);
  });
});

// --- computePathPoints ---

describe("computePathPoints", () => {
  it("computes center points of nodes", () => {
    const positions: NodePositions = {
      a: { x: 100, y: 0 },
      b: { x: 100, y: 100 },
    };
    const heights = { a: 40, b: 60 };

    const points = computePathPoints(["a", "b"], positions, 200, heights);
    expect(points).toEqual([
      { x: 200, y: 20 },   // 100 + 200/2, 0 + 40/2
      { x: 200, y: 130 },  // 100 + 200/2, 100 + 60/2
    ]);
  });

  it("returns empty for empty input", () => {
    expect(computePathPoints([], {}, 200)).toEqual([]);
  });
});

// --- buildPathD ---

describe("buildPathD", () => {
  it("builds SVG path from points", () => {
    const points = [
      { x: 10, y: 20 },
      { x: 30, y: 40 },
      { x: 50, y: 60 },
    ];
    expect(buildPathD(points)).toBe("M 10 20 L 30 40 L 50 60");
  });

  it("returns empty string for empty input", () => {
    expect(buildPathD([])).toBe("");
  });

  it("handles single point", () => {
    expect(buildPathD([{ x: 5, y: 10 }])).toBe("M 5 10");
  });
});
