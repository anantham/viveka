import { describe, it, expect } from "vitest";
import { computeFitToBox } from "../canvas-utils";

describe("computeFitToBox", () => {
  it("centers a bbox inside the viewport", () => {
    // Square bbox 100×100 centered at (50, 50); viewport 1000×1000
    const r = computeFitToBox({
      bbox: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      viewport: { width: 1000, height: 1000 },
    });
    // bbox center at canvas-coord (50, 50). After zoom z, viewport-coord
    // center of bbox = (panX + z*50, panY + z*50). That should equal
    // viewport center (500, 500).
    expect(panZoomCenter(r, { cx: 50, cy: 50 })).toEqual([500, 500]);
  });

  it("respects maxFitZoom (default 1.5) — small bboxes don't fill the viewport", () => {
    const r = computeFitToBox({
      bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      viewport: { width: 1000, height: 1000 },
    });
    expect(r.zoom).toBeLessThanOrEqual(1.5);
    expect(r.zoom).toBe(1.5);
  });

  it("scales down to fit large content", () => {
    const r = computeFitToBox({
      bbox: { minX: 0, minY: 0, maxX: 4000, maxY: 4000 },
      viewport: { width: 1000, height: 1000 },
    });
    // Without padding: zoom would be 1000/4000 = 0.25.
    // With 10% padding: avail = 800 → zoom = 800/4000 = 0.2.
    expect(r.zoom).toBeCloseTo(0.2, 5);
  });

  it("clamps to minZoom for very large content", () => {
    const r = computeFitToBox({
      bbox: { minX: 0, minY: 0, maxX: 100000, maxY: 100000 },
      viewport: { width: 1000, height: 1000 },
      minZoom: 0.15,
    });
    expect(r.zoom).toBe(0.15);
  });

  it("uses the smaller of width/height ratios (limiting dimension)", () => {
    // Wide bbox: width is the constraint.
    const r = computeFitToBox({
      bbox: { minX: 0, minY: 0, maxX: 4000, maxY: 100 },
      viewport: { width: 1000, height: 1000 },
    });
    // avail width = 800, bbox width = 4000 → ratio 0.2 (the limiter)
    expect(r.zoom).toBeCloseTo(0.2, 5);
  });

  it("never produces zoom below minZoom or above maxFitZoom", () => {
    const small = computeFitToBox({
      bbox: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      viewport: { width: 1000, height: 1000 },
      maxFitZoom: 2,
      maxZoom: 5,
    });
    expect(small.zoom).toBe(2);

    const huge = computeFitToBox({
      bbox: { minX: 0, minY: 0, maxX: 100000, maxY: 100000 },
      viewport: { width: 1000, height: 1000 },
      minZoom: 0.05,
    });
    expect(huge.zoom).toBeGreaterThanOrEqual(0.05);
  });

  it("handles zero-area bboxes (degenerate point) without dividing by zero", () => {
    const r = computeFitToBox({
      bbox: { minX: 50, minY: 50, maxX: 50, maxY: 50 },
      viewport: { width: 1000, height: 1000 },
    });
    expect(Number.isFinite(r.zoom)).toBe(true);
    expect(Number.isFinite(r.panX)).toBe(true);
    expect(Number.isFinite(r.panY)).toBe(true);
  });

  it("padding fraction shrinks the available area", () => {
    const noPad = computeFitToBox({
      bbox: { minX: 0, minY: 0, maxX: 4000, maxY: 4000 },
      viewport: { width: 1000, height: 1000 },
      paddingFraction: 0,
    });
    const withPad = computeFitToBox({
      bbox: { minX: 0, minY: 0, maxX: 4000, maxY: 4000 },
      viewport: { width: 1000, height: 1000 },
      paddingFraction: 0.2,
    });
    expect(noPad.zoom).toBeGreaterThan(withPad.zoom);
  });

  it("centers an off-origin bbox correctly", () => {
    // 200×200 bbox starting at (1000, 500); viewport 1000×1000
    const r = computeFitToBox({
      bbox: { minX: 1000, minY: 500, maxX: 1200, maxY: 700 },
      viewport: { width: 1000, height: 1000 },
    });
    expect(panZoomCenter(r, { cx: 1100, cy: 600 })).toEqual([500, 500]);
  });
});

// Helper: where does the canvas-content point (cx, cy) land in viewport-coords?
// viewport coord = panX + zoom * cx (and similar for y)
function panZoomCenter(
  r: { panX: number; panY: number; zoom: number },
  p: { cx: number; cy: number },
): [number, number] {
  return [
    Math.round(r.panX + r.zoom * p.cx),
    Math.round(r.panY + r.zoom * p.cy),
  ];
}
