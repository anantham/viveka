import { describe, it, expect } from "vitest";
import {
  createWorkspace,
  addFragment,
  updateFragmentContent,
  addEdge,
  getChildren,
  getParent,
  getSiblings,
  appendToSequence,
  insertInSequence,
  removeFromSequence,
  moveInSequence,
  moveToStage,
  moveToWorkspace,
  splitFragment,
  getWorkspaceContext,
  getConversationHistory,
  buildTreeFromEdges,
  getStagedFragments,
} from "../workspace";

// ---------------------------------------------------------------------------
// createWorkspace
// ---------------------------------------------------------------------------

describe("createWorkspace", () => {
  it("creates a root fragment containing the intent", () => {
    const ws = createWorkspace("write a haiku about rain", "5 lines", "draft");
    expect(ws.intent).toBe("write a haiku about rain");
    expect(ws.completionCondition).toBe("5 lines");
    expect(ws.mode).toBe("draft");
    expect(ws.sequence.length).toBe(1);
    const root = ws.fragments[ws.sequence[0]];
    expect(root.content).toBe("write a haiku about rain");
    expect(root.provenance.type).toBe("system");
    expect(root.status).toBe("complete");
  });

  it("uses default settings when none provided", () => {
    const ws = createWorkspace("x", "y", "z");
    expect(ws.settings.rerollCount).toBe(3);
    expect(ws.settings.draftCount).toBe(3);
    expect(ws.settings.model).toBe("sonnet");
  });

  it("respects partial settings overrides", () => {
    const ws = createWorkspace("x", "y", "z", { rerollCount: 7, model: "opus" });
    expect(ws.settings.rerollCount).toBe(7);
    expect(ws.settings.draftCount).toBe(3);
    expect(ws.settings.model).toBe("opus");
  });

  it("starts with empty edges, stageIds, opLog, contextBlockIds", () => {
    const ws = createWorkspace("x", "y", "z");
    expect(ws.edges).toEqual([]);
    expect(ws.stageIds).toEqual([]);
    expect(ws.opLog).toEqual([]);
    expect(ws.contextBlockIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Fragment CRUD
// ---------------------------------------------------------------------------

describe("addFragment", () => {
  it("creates a fragment with status 'complete' by default", () => {
    const ws = createWorkspace("x", "y", "z");
    const f = addFragment(ws, "hello", { type: "human-typed" });
    expect(f.status).toBe("complete");
    expect(f.content).toBe("hello");
    expect(f.version).toBe(1);
    expect(f.previousVersions).toEqual([]);
    expect(ws.fragments[f.id]).toBe(f);
  });

  it("respects explicit status", () => {
    const ws = createWorkspace("x", "y", "z");
    const f = addFragment(ws, "", { type: "ai-generated" }, "generating");
    expect(f.status).toBe("generating");
  });

  it("assigns unique ids", () => {
    const ws = createWorkspace("x", "y", "z");
    const a = addFragment(ws, "a", { type: "human-typed" });
    const b = addFragment(ws, "b", { type: "human-typed" });
    expect(a.id).not.toBe(b.id);
  });
});

describe("updateFragmentContent", () => {
  it("pushes previous content to previousVersions on change", () => {
    const ws = createWorkspace("x", "y", "z");
    const f = addFragment(ws, "old", { type: "human-typed" });
    updateFragmentContent(ws, f.id, "new");
    expect(f.content).toBe("new");
    expect(f.previousVersions).toEqual(["old"]);
    expect(f.version).toBe(2);
  });

  it("does not push to previousVersions when content is identical", () => {
    const ws = createWorkspace("x", "y", "z");
    const f = addFragment(ws, "same", { type: "human-typed" });
    updateFragmentContent(ws, f.id, "same");
    expect(f.previousVersions).toEqual([]);
    expect(f.version).toBe(1);
  });

  it("does not push when overwriting empty content (e.g. pending fragment)", () => {
    const ws = createWorkspace("x", "y", "z");
    const f = addFragment(ws, "", { type: "ai-generated" }, "generating");
    updateFragmentContent(ws, f.id, "filled");
    expect(f.previousVersions).toEqual([]);
    expect(f.content).toBe("filled");
  });

  it("is a no-op for unknown ids", () => {
    const ws = createWorkspace("x", "y", "z");
    expect(() => updateFragmentContent(ws, "nonexistent", "x")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

describe("edges + traversal", () => {
  it("getChildren returns fragments connected by responded-to edges", () => {
    const ws = createWorkspace("x", "y", "z");
    const a = addFragment(ws, "a", { type: "human-typed" });
    const b = addFragment(ws, "b", { type: "human-typed" });
    const c = addFragment(ws, "c", { type: "human-typed" });
    addEdge(ws, a.id, b.id, "responded-to");
    addEdge(ws, a.id, c.id, "responded-to");
    const children = getChildren(ws, a.id, "responded-to");
    expect(children.map((f) => f.id).sort()).toEqual([b.id, c.id].sort());
  });

  it("getChildren filters out edge types when requested", () => {
    const ws = createWorkspace("x", "y", "z");
    const a = addFragment(ws, "a", { type: "human-typed" });
    const b = addFragment(ws, "b", { type: "human-typed" });
    const c = addFragment(ws, "c", { type: "human-typed" });
    addEdge(ws, a.id, b.id, "responded-to");
    addEdge(ws, a.id, c.id, "derived");
    expect(getChildren(ws, a.id, "responded-to").map((f) => f.id)).toEqual([b.id]);
    expect(getChildren(ws, a.id, "derived").map((f) => f.id)).toEqual([c.id]);
    expect(getChildren(ws, a.id).map((f) => f.id).sort()).toEqual([b.id, c.id].sort());
  });

  it("getParent returns the parent via the requested edge type", () => {
    const ws = createWorkspace("x", "y", "z");
    const a = addFragment(ws, "a", { type: "human-typed" });
    const b = addFragment(ws, "b", { type: "human-typed" });
    addEdge(ws, a.id, b.id, "responded-to");
    expect(getParent(ws, b.id, "responded-to")?.id).toBe(a.id);
    expect(getParent(ws, b.id, "derived")).toBeUndefined();
  });

  it("getSiblings returns all responded-to children of the parent", () => {
    const ws = createWorkspace("x", "y", "z");
    const root = addFragment(ws, "root", { type: "human-typed" });
    const a = addFragment(ws, "a", { type: "human-typed" });
    const b = addFragment(ws, "b", { type: "human-typed" });
    const c = addFragment(ws, "c", { type: "human-typed" });
    addEdge(ws, root.id, a.id, "responded-to");
    addEdge(ws, root.id, b.id, "responded-to");
    addEdge(ws, root.id, c.id, "responded-to");
    const sibs = getSiblings(ws, b.id);
    expect(sibs.map((f) => f.id).sort()).toEqual([a.id, b.id, c.id].sort());
  });

  it("getSiblings returns the fragment alone when it has no parent", () => {
    const ws = createWorkspace("x", "y", "z");
    const orphan = addFragment(ws, "orphan", { type: "human-typed" });
    expect(getSiblings(ws, orphan.id).map((f) => f.id)).toEqual([orphan.id]);
  });
});

// ---------------------------------------------------------------------------
// Sequence ops
// ---------------------------------------------------------------------------

describe("sequence ops", () => {
  it("appendToSequence appends only if not present", () => {
    const ws = createWorkspace("x", "y", "z");
    const a = addFragment(ws, "a", { type: "human-typed" });
    appendToSequence(ws, a.id);
    appendToSequence(ws, a.id);
    expect(ws.sequence.filter((id) => id === a.id).length).toBe(1);
  });

  it("insertInSequence places at the requested index", () => {
    const ws = createWorkspace("x", "y", "z");
    const a = addFragment(ws, "a", { type: "human-typed" });
    const b = addFragment(ws, "b", { type: "human-typed" });
    appendToSequence(ws, a.id);
    appendToSequence(ws, b.id);
    const c = addFragment(ws, "c", { type: "human-typed" });
    insertInSequence(ws, c.id, 1);
    // Original ws.sequence had root then a then b. After insert at 1:
    // [root, c, a, b]
    expect(ws.sequence.indexOf(c.id)).toBe(1);
  });

  it("insertInSequence relocates an existing id rather than duplicating", () => {
    const ws = createWorkspace("x", "y", "z");
    const a = addFragment(ws, "a", { type: "human-typed" });
    const b = addFragment(ws, "b", { type: "human-typed" });
    appendToSequence(ws, a.id);
    appendToSequence(ws, b.id);
    insertInSequence(ws, a.id, 0); // pull a to the front
    expect(ws.sequence.filter((id) => id === a.id).length).toBe(1);
    expect(ws.sequence[0]).toBe(a.id);
  });

  it("removeFromSequence removes the id when present", () => {
    const ws = createWorkspace("x", "y", "z");
    const a = addFragment(ws, "a", { type: "human-typed" });
    appendToSequence(ws, a.id);
    expect(ws.sequence).toContain(a.id);
    removeFromSequence(ws, a.id);
    expect(ws.sequence).not.toContain(a.id);
  });

  it("moveInSequence forward shifts adjacent ids correctly", () => {
    const ws = createWorkspace("x", "y", "z");
    const rootId = ws.sequence[0];
    const a = addFragment(ws, "a", { type: "human-typed" });
    const b = addFragment(ws, "b", { type: "human-typed" });
    const c = addFragment(ws, "c", { type: "human-typed" });
    appendToSequence(ws, a.id);
    appendToSequence(ws, b.id);
    appendToSequence(ws, c.id);
    // [root, a, b, c]; move a (idx 1) to idx 3.
    // toIndex is relative to the original sequence; forward moves get
    // an off-by-one adjustment after removal, so a lands BEFORE c.
    moveInSequence(ws, a.id, 3);
    expect(ws.sequence).toEqual([rootId, b.id, a.id, c.id]);
  });

  it("moveInSequence backward keeps toIndex unadjusted", () => {
    const ws = createWorkspace("x", "y", "z");
    const rootId = ws.sequence[0];
    const a = addFragment(ws, "a", { type: "human-typed" });
    const b = addFragment(ws, "b", { type: "human-typed" });
    const c = addFragment(ws, "c", { type: "human-typed" });
    appendToSequence(ws, a.id);
    appendToSequence(ws, b.id);
    appendToSequence(ws, c.id);
    // [root, a, b, c]; move c (idx 3) to idx 1 → [root, c, a, b]
    moveInSequence(ws, c.id, 1);
    expect(ws.sequence).toEqual([rootId, c.id, a.id, b.id]);
  });

  it("moveInSequence logs an operation", () => {
    const ws = createWorkspace("x", "y", "z");
    const a = addFragment(ws, "a", { type: "human-typed" });
    const b = addFragment(ws, "b", { type: "human-typed" });
    appendToSequence(ws, a.id);
    appendToSequence(ws, b.id);
    moveInSequence(ws, a.id, 2);
    const last = ws.opLog.at(-1);
    expect(last?.type).toBe("move");
    if (last?.type === "move") expect(last.fragmentId).toBe(a.id);
  });

  it("moveInSequence is a no-op when fragment is not in sequence", () => {
    const ws = createWorkspace("x", "y", "z");
    const orphan = addFragment(ws, "orphan", { type: "human-typed" });
    const before = [...ws.sequence];
    const opLogBefore = ws.opLog.length;
    moveInSequence(ws, orphan.id, 0);
    expect(ws.sequence).toEqual(before);
    expect(ws.opLog.length).toBe(opLogBefore);
  });
});

// ---------------------------------------------------------------------------
// Zone ops
// ---------------------------------------------------------------------------

describe("zone ops", () => {
  it("moveToStage removes from sequence + adds to stageIds + logs", () => {
    const ws = createWorkspace("x", "y", "z");
    const a = addFragment(ws, "a", { type: "human-typed" });
    appendToSequence(ws, a.id);
    moveToStage(ws, a.id);
    expect(ws.sequence).not.toContain(a.id);
    expect(ws.stageIds).toContain(a.id);
    const last = ws.opLog.at(-1);
    expect(last?.type).toBe("zone-transfer");
  });

  it("moveToStage is idempotent on stageIds", () => {
    const ws = createWorkspace("x", "y", "z");
    const a = addFragment(ws, "a", { type: "human-typed" });
    moveToStage(ws, a.id);
    moveToStage(ws, a.id);
    expect(ws.stageIds.filter((id) => id === a.id).length).toBe(1);
  });

  it("moveToWorkspace removes from stage + appends to sequence", () => {
    const ws = createWorkspace("x", "y", "z");
    const a = addFragment(ws, "a", { type: "human-typed" });
    moveToStage(ws, a.id);
    moveToWorkspace(ws, a.id);
    expect(ws.stageIds).not.toContain(a.id);
    expect(ws.sequence).toContain(a.id);
  });

  it("moveToWorkspace with atIndex inserts at the requested position", () => {
    const ws = createWorkspace("x", "y", "z");
    const rootId = ws.sequence[0];
    const a = addFragment(ws, "a", { type: "human-typed" });
    const b = addFragment(ws, "b", { type: "human-typed" });
    appendToSequence(ws, b.id);
    moveToStage(ws, a.id); // stash a
    moveToWorkspace(ws, a.id, 1);
    expect(ws.sequence).toEqual([rootId, a.id, b.id]);
  });

  it("getStagedFragments returns only stage members", () => {
    const ws = createWorkspace("x", "y", "z");
    const a = addFragment(ws, "a", { type: "human-typed" });
    const b = addFragment(ws, "b", { type: "human-typed" });
    moveToStage(ws, a.id);
    appendToSequence(ws, b.id);
    expect(getStagedFragments(ws).map((f) => f.id)).toEqual([a.id]);
  });
});

// ---------------------------------------------------------------------------
// Split
// ---------------------------------------------------------------------------

describe("splitFragment", () => {
  it("splits content at word boundaries and replaces in sequence", () => {
    const ws = createWorkspace("x", "y", "z");
    const f = addFragment(ws, "the quick brown fox jumps", { type: "human-typed" });
    appendToSequence(ws, f.id);

    // Select "quick brown" — chars 4..15
    const results = splitFragment(ws, f.id, 4, 15);
    expect(results).not.toBeNull();
    expect(results!.length).toBe(3);
    expect(results![0].content).toBe("the");
    expect(results![1].content).toBe("quick brown");
    expect(results![2].content).toBe("fox jumps");

    expect(ws.sequence).not.toContain(f.id);
    expect(ws.sequence).toContain(results![0].id);
    expect(ws.sequence).toContain(results![1].id);
    expect(ws.sequence).toContain(results![2].id);
  });

  it("marks the original fragment as consumed", () => {
    const ws = createWorkspace("x", "y", "z");
    const f = addFragment(ws, "the quick brown fox", { type: "human-typed" });
    appendToSequence(ws, f.id);
    splitFragment(ws, f.id, 4, 15);
    expect(ws.fragments[f.id].status).toBe("pending");
    expect(ws.fragments[f.id].content).toMatch(/^\[split into/);
  });

  it("emits split-from edges from the original to each result", () => {
    const ws = createWorkspace("x", "y", "z");
    const f = addFragment(ws, "alpha beta gamma", { type: "human-typed" });
    appendToSequence(ws, f.id);
    const results = splitFragment(ws, f.id, 6, 10)!;
    for (const r of results) {
      const e = ws.edges.find((edge) => edge.from === f.id && edge.to === r.id);
      expect(e?.type).toBe("split-from");
    }
  });

  it("chains result fragments with responded-to edges", () => {
    const ws = createWorkspace("x", "y", "z");
    const f = addFragment(ws, "alpha beta gamma delta", { type: "human-typed" });
    appendToSequence(ws, f.id);
    const results = splitFragment(ws, f.id, 6, 10)!;
    for (let i = 0; i < results.length - 1; i++) {
      const link = ws.edges.find(
        (e) => e.from === results[i].id && e.to === results[i + 1].id && e.type === "responded-to",
      );
      expect(link).toBeDefined();
    }
  });

  it("returns null for invalid range (charStart >= charEnd)", () => {
    const ws = createWorkspace("x", "y", "z");
    const f = addFragment(ws, "abc def", { type: "human-typed" });
    expect(splitFragment(ws, f.id, 5, 5)).toBeNull();
  });

  it("returns null for missing fragment", () => {
    const ws = createWorkspace("x", "y", "z");
    expect(splitFragment(ws, "nonexistent", 0, 5)).toBeNull();
  });

  it("logs a split operation", () => {
    const ws = createWorkspace("x", "y", "z");
    const f = addFragment(ws, "alpha beta gamma", { type: "human-typed" });
    appendToSequence(ws, f.id);
    splitFragment(ws, f.id, 6, 10);
    const last = ws.opLog.at(-1);
    expect(last?.type).toBe("split");
    if (last?.type === "split") expect(last.sourceFragmentId).toBe(f.id);
  });
});

// ---------------------------------------------------------------------------
// Context assembly
// ---------------------------------------------------------------------------

describe("getWorkspaceContext", () => {
  it("returns sequence fragments in order, complete only", () => {
    const ws = createWorkspace("intent", "y", "z");
    const a = addFragment(ws, "first", { type: "human-typed" });
    const b = addFragment(ws, "second", { type: "ai-generated" });
    const pending = addFragment(ws, "", { type: "ai-generated" }, "generating");
    appendToSequence(ws, a.id);
    appendToSequence(ws, b.id);
    appendToSequence(ws, pending.id);

    const ctx = getWorkspaceContext(ws);
    // Root is "intent" (system), a, b. Pending excluded.
    expect(ctx.map((c) => c.content)).toEqual(["intent", "first", "second"]);
  });
});

describe("getConversationHistory", () => {
  it("excludes system fragments and emits user/assistant roles", () => {
    const ws = createWorkspace("intent", "y", "z");
    const a = addFragment(ws, "user msg", { type: "human-typed" });
    const b = addFragment(ws, "ai resp", { type: "ai-generated" });
    appendToSequence(ws, a.id);
    appendToSequence(ws, b.id);

    const hx = getConversationHistory(ws);
    expect(hx).toEqual([
      { role: "user", content: "user msg" },
      { role: "assistant", content: "ai resp" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Tree reconstruction
// ---------------------------------------------------------------------------

describe("buildTreeFromEdges", () => {
  it("identifies roots and adjacency from responded-to edges", () => {
    const ws = createWorkspace("intent", "y", "z");
    const root = ws.sequence[0];
    const a = addFragment(ws, "a", { type: "human-typed" });
    const b = addFragment(ws, "b", { type: "human-typed" });
    addEdge(ws, root, a.id, "responded-to");
    addEdge(ws, a.id, b.id, "responded-to");
    // derived edges shouldn't influence the tree
    addEdge(ws, root, b.id, "derived");

    const { roots, children } = buildTreeFromEdges(ws);
    expect(roots).toContain(root);
    expect(roots).not.toContain(a.id);
    expect(roots).not.toContain(b.id);
    expect(children[root]).toEqual([a.id]);
    expect(children[a.id]).toEqual([b.id]);
  });
});
