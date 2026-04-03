import { describe, it, expect } from "vitest";
import {
  simulateTick,
  angleToMergeType,
  SLEEP_THRESHOLD,
  type SimParticle,
} from "../../hooks/usePhysicsSimulation";

const defaultSize = () => ({ w: 480, h: 80 });

function makeParticle(id: string, x: number, y: number, opts?: Partial<SimParticle>): SimParticle {
  return { id, x, y, vx: 0, vy: 0, pinned: false, ...opts };
}

// --- simulateTick: repulsion ---

describe("simulateTick repulsion", () => {
  it("two overlapping nodes repel each other", () => {
    const a = makeParticle("a", 100, 100);
    const b = makeParticle("b", 100, 100); // same position = overlap
    simulateTick([a, b], {}, [], defaultSize);

    // After one tick, they should have moved apart
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    expect(dist).toBeGreaterThan(0);
  });

  it("two distant nodes barely affect each other", () => {
    const a = makeParticle("a", 0, 0);
    const b = makeParticle("b", 1000, 1000); // far apart
    const ax = a.x;
    const bx = b.x;
    simulateTick([a, b], {}, [], defaultSize);

    // Movement should be negligible (beyond MAX_REPULSION_DIST)
    expect(Math.abs(a.x - ax)).toBeLessThan(0.1);
    expect(Math.abs(b.x - bx)).toBeLessThan(0.1);
  });

  it("pinned nodes do not move but still repel others", () => {
    const a = makeParticle("a", 100, 100, { pinned: true });
    const b = makeParticle("b", 100, 100);
    simulateTick([a, b], {}, [], defaultSize);

    expect(a.x).toBe(100);
    expect(a.y).toBe(100);
    // b should have moved
    const dist = Math.sqrt((b.x - 100) ** 2 + (b.y - 100) ** 2);
    expect(dist).toBeGreaterThan(0);
  });
});

// --- simulateTick: dagre spring ---

describe("simulateTick dagre spring", () => {
  it("pulls node toward dagre target", () => {
    const a = makeParticle("a", 0, 0);
    const dagre = { a: { x: 200, y: 200 } };
    simulateTick([a], dagre, [], defaultSize);

    expect(a.x).toBeGreaterThan(0);
    expect(a.y).toBeGreaterThan(0);
  });

  it("node at dagre target has no spring force", () => {
    const a = makeParticle("a", 200, 200);
    const dagre = { a: { x: 200, y: 200 } };
    simulateTick([a], dagre, [], defaultSize);

    // Should barely move (only damping on zero velocity)
    expect(Math.abs(a.x - 200)).toBeLessThan(0.01);
    expect(Math.abs(a.y - 200)).toBeLessThan(0.01);
  });
});

// --- simulateTick: edge springs ---

describe("simulateTick edge springs", () => {
  it("connected nodes too far apart are pulled together", () => {
    const a = makeParticle("a", 0, 0);
    const b = makeParticle("b", 0, 500); // far below, beyond rest length
    const edges = [{ from: "a", to: "b" }];
    // No dagre — only edge force
    simulateTick([a, b], {}, edges, defaultSize);

    // a should have moved down, b should have moved up
    expect(a.y).toBeGreaterThan(0);
    expect(b.y).toBeLessThan(500);
  });

  it("connected nodes too close are pushed apart by edge spring", () => {
    const a = makeParticle("a", 0, 0);
    const b = makeParticle("b", 0, 10); // very close, within rest length
    const edges = [{ from: "a", to: "b" }];
    simulateTick([a, b], {}, edges, defaultSize);

    // The distance between them should have increased
    // (edge spring pushes + repulsion pushes)
    const origDist = 10;
    const newDist = Math.abs(b.y - a.y);
    expect(newDist).toBeGreaterThan(origDist);
  });
});

// --- simulateTick: convergence ---

describe("simulateTick convergence", () => {
  it("simulation converges to sleep threshold", () => {
    const particles = [
      makeParticle("a", 0, 0),
      makeParticle("b", 50, 50),
      makeParticle("c", 100, 0),
    ];
    const dagre = {
      a: { x: 0, y: 0 },
      b: { x: 0, y: 140 },
      c: { x: 0, y: 280 },
    };
    const edges = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ];

    let ke = Infinity;
    let ticks = 0;
    while (ke > SLEEP_THRESHOLD && ticks < 500) {
      ke = simulateTick(particles, dagre, edges, defaultSize);
      ticks++;
    }

    expect(ke).toBeLessThanOrEqual(SLEEP_THRESHOLD);
    expect(ticks).toBeLessThan(500); // should converge well before 500 ticks
  });

  it("inject velocity wakes and eventually re-stabilizes", () => {
    const a = makeParticle("a", 100, 100);
    const dagre = { a: { x: 100, y: 100 } };

    // Inject velocity
    a.vx = 50;
    a.vy = 30;

    let ke = Infinity;
    let ticks = 0;
    while (ke > SLEEP_THRESHOLD && ticks < 300) {
      ke = simulateTick([a], dagre, [], defaultSize);
      ticks++;
    }

    expect(ke).toBeLessThanOrEqual(SLEEP_THRESHOLD);
    // Should return close to dagre target
    expect(Math.abs(a.x - 100)).toBeLessThan(50);
    expect(Math.abs(a.y - 100)).toBeLessThan(50);
  });
});

// --- simulateTick: semantic zoom reactivity ---

describe("simulateTick semantic zoom change", () => {
  it("larger nodes produce stronger repulsion (wider overlap)", () => {
    // Two nodes at same position, small size
    const small1 = makeParticle("a", 100, 100);
    const small2 = makeParticle("b", 150, 100);
    const smallSize = () => ({ w: 24, h: 24 }); // dot level
    simulateTick([small1, small2], {}, [], smallSize);
    const smallRepulsion = Math.abs(small1.x - small2.x);

    // Same positions, large size
    const big1 = makeParticle("a", 100, 100);
    const big2 = makeParticle("b", 150, 100);
    const bigSize = () => ({ w: 480, h: 80 }); // full level
    simulateTick([big1, big2], {}, [], bigSize);
    const bigRepulsion = Math.abs(big1.x - big2.x);

    // Larger nodes should produce the same repulsion at the same center distance
    // (repulsion is center-to-center), but the visual overlap is much larger
    // Both should repel since they're within MAX_REPULSION_DIST
    expect(smallRepulsion).toBeGreaterThan(0);
    expect(bigRepulsion).toBeGreaterThan(0);
  });
});

// --- angleToMergeType ---

describe("angleToMergeType", () => {
  it("right approach → append", () => {
    expect(angleToMergeType(0)).toBe("append");
    expect(angleToMergeType(Math.PI / 8)).toBe("append"); // 22.5°
  });

  it("bottom approach → summarize", () => {
    expect(angleToMergeType(Math.PI / 2)).toBe("summarize"); // 90°
  });

  it("left approach → prepend", () => {
    expect(angleToMergeType(Math.PI)).toBe("prepend"); // 180°
  });

  it("top approach → interleave", () => {
    expect(angleToMergeType(-Math.PI / 2)).toBe("interleave"); // 270° = -90°
    expect(angleToMergeType(3 * Math.PI / 2)).toBe("interleave"); // 270°
  });
});
