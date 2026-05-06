import { describe, it, expect } from "vitest";
import {
  createWorkspace,
  addFragment,
  appendToSequence,
  moveToStage,
  mergeFragments,
  unmergeFragments,
  updateFragmentContent,
} from "../workspace";

function setupTwoSequenced(contentA = "alpha content", contentB = "beta content") {
  const ws = createWorkspace("test intent", "done", "draft");
  const a = addFragment(ws, contentA, { type: "human-typed" });
  const b = addFragment(ws, contentB, { type: "ai-generated" });
  appendToSequence(ws, a.id);
  appendToSequence(ws, b.id);
  return { ws, a, b };
}

// ---------------------------------------------------------------------------
// mergeFragments — happy path
// ---------------------------------------------------------------------------

describe("mergeFragments", () => {
  it("returns null if either fragment is missing", () => {
    const ws = createWorkspace("x", "y", "z");
    const a = addFragment(ws, "a", { type: "human-typed" });
    expect(mergeFragments(ws, a.id, "nonexistent")).toBeNull();
    expect(mergeFragments(ws, "nonexistent", a.id)).toBeNull();
  });

  it("creates a merged fragment in 'generating' status with both sources as provenance", () => {
    const { ws, a, b } = setupTwoSequenced();
    const result = mergeFragments(ws, a.id, b.id)!;
    expect(result.mergedFrag.status).toBe("generating");
    expect(result.mergedFrag.content).toBe("");
    expect(result.mergedFrag.provenance.type).toBe("merged");
    expect(result.mergedFrag.provenance.sourceFragmentIds).toEqual([a.id, b.id]);
    expect(result.mergedFrag.timing?.startedAt).toBeTruthy();
  });

  it("returns the original source/target contents (for the LLM caller)", () => {
    const { ws, a, b } = setupTwoSequenced("source text", "target text");
    const result = mergeFragments(ws, a.id, b.id)!;
    expect(result.sourceContent).toBe("source text");
    expect(result.targetContent).toBe("target text");
  });

  it("hides source/target by stashing original content in previousVersions", () => {
    const { ws, a, b } = setupTwoSequenced();
    mergeFragments(ws, a.id, b.id);
    expect(ws.fragments[a.id].previousVersions).toContain("alpha content");
    expect(ws.fragments[b.id].previousVersions).toContain("beta content");
    expect(ws.fragments[a.id].status).toBe("pending");
    expect(ws.fragments[b.id].status).toBe("pending");
    expect(ws.fragments[a.id].content).toMatch(/^\[merged into/);
    expect(ws.fragments[b.id].content).toMatch(/^\[merged into/);
  });

  it("adds derived edges from each source to the merged fragment", () => {
    const { ws, a, b } = setupTwoSequenced();
    const { mergedFrag } = mergeFragments(ws, a.id, b.id)!;
    expect(ws.edges).toContainEqual({ from: a.id, to: mergedFrag.id, type: "derived" });
    expect(ws.edges).toContainEqual({ from: b.id, to: mergedFrag.id, type: "derived" });
  });

  it("replaces sources with merged fragment in sequence (target's position)", () => {
    const { ws, a, b } = setupTwoSequenced();
    const rootId = ws.sequence[0];
    expect(ws.sequence).toEqual([rootId, a.id, b.id]);
    const { mergedFrag } = mergeFragments(ws, a.id, b.id)!;
    // Both originals removed; merged sits where target was.
    expect(ws.sequence).toEqual([rootId, mergedFrag.id]);
  });

  it("inherits target's canvas position when present", () => {
    const { ws, a, b } = setupTwoSequenced();
    ws.canvasPositions[a.id] = { x: 100, y: 100 };
    ws.canvasPositions[b.id] = { x: 500, y: 500 };
    const { mergedFrag } = mergeFragments(ws, a.id, b.id)!;
    expect(ws.canvasPositions[mergedFrag.id]).toEqual({ x: 500, y: 500 });
    expect(ws.canvasPositions[a.id]).toBeUndefined();
    expect(ws.canvasPositions[b.id]).toBeUndefined();
  });

  it("falls back to source's canvas position when target has none", () => {
    const ws = createWorkspace("x", "y", "z");
    const a = addFragment(ws, "a", { type: "human-typed" });
    const b = addFragment(ws, "b", { type: "human-typed" });
    appendToSequence(ws, a.id);
    appendToSequence(ws, b.id);
    ws.canvasPositions[a.id] = { x: 1, y: 2 };
    const { mergedFrag } = mergeFragments(ws, a.id, b.id)!;
    expect(ws.canvasPositions[mergedFrag.id]).toEqual({ x: 1, y: 2 });
  });

  it("when neither was placed, appends the merged fragment to sequence", () => {
    const ws = createWorkspace("x", "y", "z");
    const a = addFragment(ws, "a", { type: "human-typed" });
    const b = addFragment(ws, "b", { type: "human-typed" });
    // Neither in sequence/stage
    const { mergedFrag } = mergeFragments(ws, a.id, b.id)!;
    expect(ws.sequence).toContain(mergedFrag.id);
  });

  it("merges from stage when source is staged + target sequenced", () => {
    const { ws, a, b } = setupTwoSequenced();
    moveToStage(ws, a.id);
    const rootId = ws.sequence[0];
    expect(ws.sequence).toEqual([rootId, b.id]);
    expect(ws.stageIds).toEqual([a.id]);
    const { mergedFrag } = mergeFragments(ws, a.id, b.id)!;
    expect(ws.stageIds).toEqual([]);
    expect(ws.sequence).toContain(mergedFrag.id);
  });
});

// ---------------------------------------------------------------------------
// preMergeSnapshot — the bug fix
// ---------------------------------------------------------------------------

describe("mergeFragments preMergeSnapshot", () => {
  it("captures TRUE pre-mutation sequence indices (not -1)", () => {
    const { ws, a, b } = setupTwoSequenced();
    // Pre-merge: ws.sequence is [root, a, b] → a at idx 1, b at idx 2.
    mergeFragments(ws, a.id, b.id);
    const mergeOp = ws.opLog.find((op) => op.type === "merge");
    expect(mergeOp).toBeDefined();
    if (mergeOp?.type === "merge") {
      expect(mergeOp.preMergeSnapshot).toBeDefined();
      expect(mergeOp.preMergeSnapshot!.preSourceSeqIdx).toBe(1);
      expect(mergeOp.preMergeSnapshot!.preTargetSeqIdx).toBe(2);
      expect(mergeOp.preMergeSnapshot!.sourceWasInSequence).toBe(true);
      expect(mergeOp.preMergeSnapshot!.targetWasInSequence).toBe(true);
      expect(mergeOp.preMergeSnapshot!.sourceWasInStage).toBe(false);
      expect(mergeOp.preMergeSnapshot!.targetWasInStage).toBe(false);
    }
  });

  it("captures stage membership when applicable", () => {
    const { ws, a, b } = setupTwoSequenced();
    moveToStage(ws, a.id);
    mergeFragments(ws, a.id, b.id);
    const mergeOp = ws.opLog.find((op) => op.type === "merge");
    if (mergeOp?.type === "merge") {
      expect(mergeOp.preMergeSnapshot!.sourceWasInStage).toBe(true);
      expect(mergeOp.preMergeSnapshot!.targetWasInSequence).toBe(true);
      expect(mergeOp.preMergeSnapshot!.preSourceSeqIdx).toBe(-1); // not in seq
      expect(mergeOp.preMergeSnapshot!.preTargetSeqIdx).toBeGreaterThanOrEqual(0);
    }
  });

  it("captures indices reflecting reverse-order sources (target before source)", () => {
    const ws = createWorkspace("x", "y", "z");
    const rootId = ws.sequence[0];
    const target = addFragment(ws, "B target", { type: "human-typed" });
    const source = addFragment(ws, "A source", { type: "human-typed" });
    appendToSequence(ws, target.id);
    appendToSequence(ws, source.id);
    // [root, target, source] — target at 1, source at 2.

    mergeFragments(ws, source.id, target.id);
    const mergeOp = ws.opLog.find((op) => op.type === "merge");
    if (mergeOp?.type === "merge") {
      expect(mergeOp.preMergeSnapshot!.preSourceSeqIdx).toBe(2);
      expect(mergeOp.preMergeSnapshot!.preTargetSeqIdx).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// unmergeFragments — round-trip
// ---------------------------------------------------------------------------

describe("unmergeFragments", () => {
  it("returns error when merged id is missing", () => {
    const ws = createWorkspace("x", "y", "z");
    const r = unmergeFragments(ws, "nonexistent");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not found/i);
  });

  it("returns error when fragment isn't a merge result", () => {
    const ws = createWorkspace("x", "y", "z");
    const a = addFragment(ws, "a", { type: "human-typed" });
    const r = unmergeFragments(ws, a.id);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not a merged result/i);
  });

  it("restores both sources' contents from previousVersions", () => {
    const { ws, a, b } = setupTwoSequenced();
    const { mergedFrag } = mergeFragments(ws, a.id, b.id)!;
    // Simulate the LLM completion overwriting the merged content
    updateFragmentContent(ws, mergedFrag.id, "merged result text");
    expect(ws.fragments[a.id].content).not.toBe("alpha content");

    const r = unmergeFragments(ws, mergedFrag.id);
    expect(r.ok).toBe(true);
    expect(r.restoredIds.sort()).toEqual([a.id, b.id].sort());
    expect(ws.fragments[a.id].content).toBe("alpha content");
    expect(ws.fragments[b.id].content).toBe("beta content");
    expect(ws.fragments[a.id].status).toBe("complete");
    expect(ws.fragments[b.id].status).toBe("complete");
  });

  it("removes the merged fragment, its derived edges, and canvas position", () => {
    const { ws, a, b } = setupTwoSequenced();
    ws.canvasPositions[b.id] = { x: 10, y: 20 };
    const { mergedFrag } = mergeFragments(ws, a.id, b.id)!;
    expect(ws.canvasPositions[mergedFrag.id]).toBeDefined();

    unmergeFragments(ws, mergedFrag.id);
    expect(ws.fragments[mergedFrag.id]).toBeUndefined();
    expect(ws.edges.some((e) => e.from === mergedFrag.id || e.to === mergedFrag.id)).toBe(false);
    expect(ws.canvasPositions[mergedFrag.id]).toBeUndefined();
  });

  it("restores sources to sequence in original order (when both were sequenced)", () => {
    const { ws, a, b } = setupTwoSequenced();
    const rootId = ws.sequence[0];
    const { mergedFrag } = mergeFragments(ws, a.id, b.id)!;
    expect(ws.sequence).toEqual([rootId, mergedFrag.id]);

    unmergeFragments(ws, mergedFrag.id);
    // a was at idx 1, b at idx 2 — restore should preserve a-then-b
    expect(ws.sequence).toEqual([rootId, a.id, b.id]);
  });

  it("restores in REVERSE order when target preceded source pre-merge", () => {
    // This is the case the index bug used to silently break.
    const ws = createWorkspace("x", "y", "z");
    const rootId = ws.sequence[0];
    const target = addFragment(ws, "TARGET", { type: "human-typed" });
    const source = addFragment(ws, "SOURCE", { type: "human-typed" });
    appendToSequence(ws, target.id);
    appendToSequence(ws, source.id);
    // [root, target, source] — target at idx 1, source at idx 2

    const { mergedFrag } = mergeFragments(ws, source.id, target.id)!;
    unmergeFragments(ws, mergedFrag.id);

    // After unmerge, original sequence order should be [root, target, source].
    // With the old bug both indices were -1 → stable sort kept sourceIds[0]=source first
    // → wrongly produced [root, source, target].
    expect(ws.sequence).toEqual([rootId, target.id, source.id]);
  });

  it("restores only the source that was originally in sequence (other was staged)", () => {
    const { ws, a, b } = setupTwoSequenced();
    moveToStage(ws, a.id);
    // Now: sequence=[root, b], stage=[a]
    const { mergedFrag } = mergeFragments(ws, a.id, b.id)!;
    unmergeFragments(ws, mergedFrag.id);
    // b goes back to sequence, a goes back to stage
    expect(ws.sequence.filter((id) => id === b.id).length).toBe(1);
    expect(ws.sequence.filter((id) => id === a.id).length).toBe(0);
    expect(ws.stageIds).toContain(a.id);
  });

  it("logs an unmerge operation in opLog", () => {
    const { ws, a, b } = setupTwoSequenced();
    const { mergedFrag } = mergeFragments(ws, a.id, b.id)!;
    unmergeFragments(ws, mergedFrag.id);
    const last = ws.opLog.at(-1);
    expect(last?.type).toBe("unmerge");
    if (last?.type === "unmerge") {
      expect(last.mergedId).toBe(mergedFrag.id);
      expect(last.restoredIds.sort()).toEqual([a.id, b.id].sort());
    }
  });
});

// ---------------------------------------------------------------------------
// merge → unmerge round-trip integrity
// ---------------------------------------------------------------------------

describe("merge → unmerge round-trip", () => {
  it("leaves sequence + fragments + content identical to pre-merge state", () => {
    const { ws, a, b } = setupTwoSequenced("first", "second");
    const seqBefore = [...ws.sequence];
    const aContent = ws.fragments[a.id].content;
    const bContent = ws.fragments[b.id].content;

    const { mergedFrag } = mergeFragments(ws, a.id, b.id)!;
    updateFragmentContent(ws, mergedFrag.id, "merged llm output");
    unmergeFragments(ws, mergedFrag.id);

    expect(ws.sequence).toEqual(seqBefore);
    expect(ws.fragments[a.id].content).toBe(aContent);
    expect(ws.fragments[b.id].content).toBe(bContent);
    expect(ws.fragments[mergedFrag.id]).toBeUndefined();
  });
});
