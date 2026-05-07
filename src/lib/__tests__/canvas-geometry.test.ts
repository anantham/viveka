import { describe, it, expect } from "vitest";
import {
  snapToInsertionBoundary,
  computeMergeIntent,
  computeEffectiveWidths,
  computeProximityPairs,
  type FragmentBox,
} from "../canvas-geometry";

// ---------------------------------------------------------------------------
// snapToInsertionBoundary
// ---------------------------------------------------------------------------

describe("snapToInsertionBoundary", () => {
  it("returns 0 for offsets at or below 0", () => {
    expect(snapToInsertionBoundary("hello world", 0)).toBe(0);
    expect(snapToInsertionBoundary("hello world", -5)).toBe(0);
  });

  it("returns text length for offsets at or above length", () => {
    const text = "hello world";
    expect(snapToInsertionBoundary(text, text.length)).toBe(text.length);
    expect(snapToInsertionBoundary(text, text.length + 100)).toBe(text.length);
  });

  it("snaps to nearest paragraph break (preferred boundary)", () => {
    const text = "First paragraph here.\n\nSecond paragraph here.";
    // raw position 22 = right at the end of first paragraph
    const snapped = snapToInsertionBoundary(text, 22);
    expect(snapped).toBe(23); // \n\n ends at index 23 (after second \n)
  });

  it("snaps to sentence end when no paragraph break nearby", () => {
    const text = "First sentence. Second sentence. Third sentence.";
    // raw 18 = inside "Second"; "First sentence. " ends at 16
    const snapped = snapToInsertionBoundary(text, 18);
    // Should snap to one of the sentence ends within 30 chars
    expect([16, 33].includes(snapped)).toBe(true);
  });

  it("falls back to word boundary when no sentence/paragraph nearby", () => {
    const text = "alpha beta gamma delta";
    // Position 7 = inside "beta"; nearest space before is at 5
    const snapped = snapToInsertionBoundary(text, 7);
    expect([6, 11].includes(snapped)).toBe(true);
  });

  it("falls back to raw offset when no boundary found", () => {
    const text = "abcdefghijklmnop";
    // No spaces, no sentence ends, no paragraphs
    const snapped = snapToInsertionBoundary(text, 8);
    expect(snapped).toBe(8);
  });

  it("prefers paragraph break over sentence/word", () => {
    // text: "Sentence one. \n\nSecond starts here."
    // "Sentence one. " = 14 chars (0..13), \n at 14, \n at 15, "S" at 16
    // Snap-to-paragraph returns i+2 where text[i]=text[i+1]='\n' → 14+2 = 16
    const text = "Sentence one. \n\nSecond starts here.";
    const snapped = snapToInsertionBoundary(text, 16);
    expect(snapped).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// computeMergeIntent
// ---------------------------------------------------------------------------

describe("computeMergeIntent", () => {
  // Standard target: bbox at (0,0), 100w × 200h, content of length 300
  const targetPos = { x: 0, y: 0 };
  const targetSize = { w: 100, h: 200 };
  const targetContent = "x".repeat(300);
  const draggedSize = { w: 100, h: 50 };

  it("returns SUMMARIZE when dragged center is above target bbox", () => {
    const r = computeMergeIntent({
      draggedPos: { x: 0, y: -100 }, // center y = -75 (above)
      draggedSize,
      targetPos,
      targetSize,
      targetContent,
    });
    expect(r.mergeType).toBe("summarize");
  });

  it("returns INTERLEAVE when dragged center is below target bbox", () => {
    const r = computeMergeIntent({
      draggedPos: { x: 0, y: 250 }, // center y = 275 (below 200)
      draggedSize,
      targetPos,
      targetSize,
      targetContent,
    });
    expect(r.mergeType).toBe("interleave");
  });

  it("returns PREPEND when dragged center is in top 15% of target", () => {
    const r = computeMergeIntent({
      draggedPos: { x: 0, y: -10 }, // center y = 15, t = 15/200 = 0.075
      draggedSize,
      targetPos,
      targetSize,
      targetContent,
    });
    expect(r.mergeType).toBe("prepend");
  });

  it("returns APPEND when dragged center is in bottom 15% of target", () => {
    const r = computeMergeIntent({
      draggedPos: { x: 0, y: 160 }, // center y = 185, t = 185/200 = 0.925
      draggedSize,
      targetPos,
      targetSize,
      targetContent,
    });
    expect(r.mergeType).toBe("append");
  });

  it("returns INSERT with a snapped offset when dragged center is in body", () => {
    const r = computeMergeIntent({
      draggedPos: { x: 0, y: 75 }, // center y = 100, t = 100/200 = 0.5
      draggedSize,
      targetPos,
      targetSize,
      targetContent,
    });
    expect(r.mergeType).toBe("insert");
    expect(typeof r.insertOffset).toBe("number");
    // Roughly halfway through 300 chars → ~150 raw, snapped to nearest boundary
    expect(r.insertOffset).toBeGreaterThanOrEqual(0);
    expect(r.insertOffset).toBeLessThanOrEqual(300);
  });

  it("returns PREPEND for an empty target (insert can't compute)", () => {
    const r = computeMergeIntent({
      draggedPos: { x: 0, y: 75 },
      draggedSize,
      targetPos,
      targetSize,
      targetContent: "",
    });
    expect(r.mergeType).toBe("prepend");
    expect(r.insertOffset).toBeUndefined();
  });

  it("snaps insert offset to a paragraph break when content has them", () => {
    const content =
      "First paragraph here.\n\n" +    // 0..23
      "Second paragraph here.\n\n" +   // 23..47
      "Third paragraph here.";          // 47..68
    // Roughly 50% through 68 chars = 34 → nearest \n\n boundary is at 47
    const r = computeMergeIntent({
      draggedPos: { x: 0, y: 75 }, // t=0.5
      draggedSize,
      targetPos,
      targetSize: { w: 100, h: 200 },
      targetContent: content,
    });
    expect(r.mergeType).toBe("insert");
    // Should land on either the 23 or 47 paragraph break
    expect([23, 47]).toContain(r.insertOffset);
  });
});

// ---------------------------------------------------------------------------
// computeEffectiveWidths
// ---------------------------------------------------------------------------

describe("computeEffectiveWidths", () => {
  const baseWidth = 480;
  const minWidth = 200;

  it("returns full baseWidth when there are no neighbors", () => {
    const fragments: FragmentBox[] = [
      { id: "a", pos: { x: 0, y: 0 }, height: 100 },
    ];
    const r = computeEffectiveWidths({ fragments, baseWidth, minWidth });
    expect(r.a).toBe(baseWidth);
  });

  it("returns full baseWidth when neighbors don't vertically overlap", () => {
    // a at y=0..100, b at y=200..300 — no vertical overlap
    const fragments: FragmentBox[] = [
      { id: "a", pos: { x: 0, y: 0 }, height: 100 },
      { id: "b", pos: { x: 100, y: 200 }, height: 100 },
    ];
    const r = computeEffectiveWidths({ fragments, baseWidth, minWidth });
    expect(r.a).toBe(baseWidth);
    expect(r.b).toBe(baseWidth);
  });

  it("narrows on the right when a neighbor encroaches from the right", () => {
    // a at x=0..480; b at x=400..880, vertically overlapping
    // b's left (400) is inside a's column [0..480] → right encroachment of 80
    const fragments: FragmentBox[] = [
      { id: "a", pos: { x: 0, y: 0 }, height: 100 },
      { id: "b", pos: { x: 400, y: 50 }, height: 100 },
    ];
    const r = computeEffectiveWidths({ fragments, baseWidth, minWidth });
    expect(r.a).toBe(baseWidth - 80);
  });

  it("narrows on the left when a neighbor encroaches from the left", () => {
    // a at x=200..680, b at x=0..480; b's right (480) is inside a's column → left encroachment of 280
    const fragments: FragmentBox[] = [
      { id: "a", pos: { x: 200, y: 0 }, height: 100 },
      { id: "b", pos: { x: 0, y: 50 }, height: 100 },
    ];
    const r = computeEffectiveWidths({ fragments, baseWidth, minWidth });
    expect(r.a).toBe(baseWidth - 280);
  });

  it("floors at minWidth when encroachment exceeds it", () => {
    // Many neighbors squeezing from both sides
    const fragments: FragmentBox[] = [
      { id: "a", pos: { x: 100, y: 0 }, height: 100 },
      { id: "left", pos: { x: 0, y: 50 }, height: 100 },
      { id: "right", pos: { x: 200, y: 50 }, height: 100 },
    ];
    const r = computeEffectiveWidths({ fragments, baseWidth, minWidth });
    expect(r.a).toBeGreaterThanOrEqual(minWidth);
  });

  it("uses the deepest encroachment when multiple neighbors overlap on the same side", () => {
    const fragments: FragmentBox[] = [
      { id: "a", pos: { x: 0, y: 0 }, height: 100 },
      { id: "b", pos: { x: 400, y: 25 }, height: 50 }, // 80 in
      { id: "c", pos: { x: 350, y: 50 }, height: 50 }, // 130 in (deeper)
    ];
    const r = computeEffectiveWidths({ fragments, baseWidth, minWidth });
    expect(r.a).toBe(baseWidth - 130);
  });
});

// ---------------------------------------------------------------------------
// computeProximityPairs
// ---------------------------------------------------------------------------

describe("computeProximityPairs", () => {
  const baseWidth = 480;
  const rFlow = 280;
  const rMerge = 90;

  it("returns no pairs when fragments are beyond rFlow", () => {
    const fragments: FragmentBox[] = [
      { id: "a", pos: { x: 0, y: 0 }, height: 100 },
      { id: "b", pos: { x: 1000, y: 0 }, height: 100 },
    ];
    const pairs = computeProximityPairs({ fragments, baseWidth, rFlow, rMerge });
    expect(pairs).toHaveLength(0);
  });

  it("emits a pair with intensity ramping from 0 (at rFlow) to 1 (at rMerge)", () => {
    // Centers exactly rMerge apart → intensity 1
    // Center-of-A: (0 + 240, 0 + 50) = (240, 50)
    // Center-of-B for distance rMerge → place B such that center distance == 90
    const fragments: FragmentBox[] = [
      { id: "a", pos: { x: 0, y: 0 }, height: 100 },
      { id: "b", pos: { x: 90, y: 0 }, height: 100 }, // centers 90 apart on x
    ];
    const pairs = computeProximityPairs({ fragments, baseWidth, rFlow, rMerge });
    expect(pairs).toHaveLength(1);
    expect(pairs[0].dist).toBeCloseTo(90, 0);
    expect(pairs[0].intensity).toBeCloseTo(1, 1);
  });

  it("intensity decays as distance increases toward rFlow", () => {
    const fragments: FragmentBox[] = [
      { id: "a", pos: { x: 0, y: 0 }, height: 100 },
      { id: "b", pos: { x: 200, y: 0 }, height: 100 },
    ];
    const pairs = computeProximityPairs({ fragments, baseWidth, rFlow, rMerge });
    expect(pairs).toHaveLength(1);
    expect(pairs[0].intensity).toBeGreaterThan(0);
    expect(pairs[0].intensity).toBeLessThan(1);
  });

  it("emits all-pairs combinations when N fragments are close", () => {
    const fragments: FragmentBox[] = [
      { id: "a", pos: { x: 0, y: 0 }, height: 100 },
      { id: "b", pos: { x: 50, y: 0 }, height: 100 },
      { id: "c", pos: { x: 100, y: 0 }, height: 100 },
    ];
    const pairs = computeProximityPairs({ fragments, baseWidth, rFlow, rMerge });
    expect(pairs).toHaveLength(3); // a-b, a-c, b-c
    const keys = pairs.map((p) => `${p.a}-${p.b}`).sort();
    expect(keys).toEqual(["a-b", "a-c", "b-c"]);
  });

  it("does not emit reversed duplicates", () => {
    const fragments: FragmentBox[] = [
      { id: "a", pos: { x: 0, y: 0 }, height: 100 },
      { id: "b", pos: { x: 50, y: 0 }, height: 100 },
    ];
    const pairs = computeProximityPairs({ fragments, baseWidth, rFlow, rMerge });
    expect(pairs).toHaveLength(1);
  });
});
