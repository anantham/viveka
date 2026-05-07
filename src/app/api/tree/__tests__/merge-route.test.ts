import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  __resetStore,
  __seedStore,
  __getStoredWorkspace,
  workspaceStoreMock,
  claudeMock,
  __resetClaude,
  setClaudeResponse,
  setClaudeError,
  getClaudeCalls,
  fixtureWithTwoFragments,
  buildPostRequest,
  flushAsync,
} from "./_helpers";

vi.mock("@/lib/workspace-store", () => workspaceStoreMock());
vi.mock("@/lib/claude", () => claudeMock());

// Import AFTER mocks so the route picks up the mocked modules.
import { POST as mergePOST } from "../merge/route";
import { POST as unmergePOST } from "../unmerge/route";

beforeEach(() => {
  __resetStore();
  __resetClaude();
});

describe("/api/tree/merge", () => {
  it("returns 404 when treeId not found", async () => {
    const res = await mergePOST(
      buildPostRequest({
        treeId: "nonexistent",
        sourceId: "x",
        targetId: "y",
        mergeType: "append",
      }) as never,
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 when source/target fragments missing", async () => {
    const { ws } = fixtureWithTwoFragments();
    __seedStore(ws);
    const res = await mergePOST(
      buildPostRequest({
        treeId: ws.id,
        sourceId: "missing",
        targetId: "alsogone",
        mergeType: "append",
      }) as never,
    );
    expect(res.status).toBe(404);
  });

  it("happy path: returns generating result + persists merge state", async () => {
    const { ws, fragA, fragB } = fixtureWithTwoFragments();
    __seedStore(ws);

    const res = await mergePOST(
      buildPostRequest({
        treeId: ws.id,
        sourceId: fragA.id,
        targetId: fragB.id,
        mergeType: "append",
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("generating");
    expect(typeof body.resultId).toBe("string");

    // Workspace state after the route returns: merged fragment exists
    // with merged-provenance, sources have been stashed. (Status may
    // already be "complete" because our mock LLM resolves instantly —
    // status timing is covered by the dedicated tests below.)
    const after = __getStoredWorkspace(ws.id)!;
    const merged = after.fragments[body.resultId];
    expect(merged).toBeDefined();
    expect(merged.provenance.type).toBe("merged");
    expect(merged.provenance.sourceFragmentIds).toEqual([fragA.id, fragB.id]);

    expect(after.fragments[fragA.id].previousVersions).toContain(fragA.content);
    expect(after.fragments[fragB.id].previousVersions).toContain(fragB.content);
  });

  it("patches the merge op in opLog with prompt + model + mergeType", async () => {
    const { ws, fragA, fragB } = fixtureWithTwoFragments();
    __seedStore(ws);
    setClaudeResponse("MERGED OUTPUT");

    await mergePOST(
      buildPostRequest({
        treeId: ws.id,
        sourceId: fragA.id,
        targetId: fragB.id,
        mergeType: "append",
      }) as never,
    );

    const after = __getStoredWorkspace(ws.id)!;
    const mergeOp = after.opLog.find((op) => op.type === "merge");
    expect(mergeOp).toBeDefined();
    if (mergeOp?.type === "merge") {
      expect(mergeOp.prompt).toContain(fragA.content);
      expect(mergeOp.prompt).toContain(fragB.content);
      expect(mergeOp.mergeType).toBe("append");
      expect(mergeOp.model).toBeTruthy();
    }
  });

  it("captures preMergeSnapshot indices BEFORE sequence mutation (regression)", async () => {
    // Regression: merge route used to call indexOf() AFTER mutating
    // ws.sequence, leaving both indices at -1.
    const { ws, fragA, fragB } = fixtureWithTwoFragments();
    __seedStore(ws);

    // Pre-merge: ws.sequence = [root, A, B] → A at idx 1, B at idx 2
    expect(ws.sequence.indexOf(fragA.id)).toBe(1);
    expect(ws.sequence.indexOf(fragB.id)).toBe(2);

    await mergePOST(
      buildPostRequest({
        treeId: ws.id,
        sourceId: fragA.id,
        targetId: fragB.id,
        mergeType: "append",
      }) as never,
    );

    const after = __getStoredWorkspace(ws.id)!;
    const mergeOp = after.opLog.find((op) => op.type === "merge");
    if (mergeOp?.type === "merge") {
      expect(mergeOp.preMergeSnapshot?.preSourceSeqIdx).toBe(1);
      expect(mergeOp.preMergeSnapshot?.preTargetSeqIdx).toBe(2);
    }
  });

  it("LLM completion fills in merged fragment content + duration", async () => {
    const { ws, fragA, fragB } = fixtureWithTwoFragments();
    __seedStore(ws);
    setClaudeResponse("Real merged content from LLM");

    const res = await mergePOST(
      buildPostRequest({
        treeId: ws.id,
        sourceId: fragA.id,
        targetId: fragB.id,
        mergeType: "append",
      }) as never,
    );
    const { resultId } = await res.json();

    // Wait for the fire-and-forget LLM call to land
    await flushAsync(80);

    const after = __getStoredWorkspace(ws.id)!;
    const merged = after.fragments[resultId];
    expect(merged.status).toBe("complete");
    expect(merged.content).toBe("Real merged content from LLM");
    expect(merged.timing?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("LLM error sets merged fragment status=error", async () => {
    const { ws, fragA, fragB } = fixtureWithTwoFragments();
    __seedStore(ws);
    setClaudeError(new Error("upstream failure"));

    const res = await mergePOST(
      buildPostRequest({
        treeId: ws.id,
        sourceId: fragA.id,
        targetId: fragB.id,
        mergeType: "append",
      }) as never,
    );
    const { resultId } = await res.json();

    await flushAsync(80);

    const after = __getStoredWorkspace(ws.id)!;
    expect(after.fragments[resultId].status).toBe("error");
    expect(after.fragments[resultId].error).toContain("upstream failure");
  });

  it("insert mode passes insertOffset to the LLM prompt", async () => {
    const { ws, fragA, fragB } = fixtureWithTwoFragments();
    __seedStore(ws);

    await mergePOST(
      buildPostRequest({
        treeId: ws.id,
        sourceId: fragA.id,
        targetId: fragB.id,
        mergeType: "insert",
        insertOffset: 5,
      }) as never,
    );

    const calls = getClaudeCalls();
    expect(calls.length).toBe(1);
    expect(calls[0].prompt).toContain("INSERT FRAGMENT A HERE");
    // The marker should be at offset 5 within the target content
    const idx = calls[0].prompt.indexOf("<<INSERT FRAGMENT A HERE>>");
    const targetSnippet = calls[0].prompt.slice(idx - 5, idx);
    expect(targetSnippet).toBe(fragB.content.slice(0, 5));
  });
});

describe("/api/tree/unmerge", () => {
  it("returns 400 if missing required fields", async () => {
    const res = await unmergePOST(
      buildPostRequest({ mergedId: "x" }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 if treeId not found", async () => {
    const res = await unmergePOST(
      buildPostRequest({ treeId: "nope", mergedId: "x" }) as never,
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 if mergedId fragment doesn't exist", async () => {
    const { ws } = fixtureWithTwoFragments();
    __seedStore(ws);
    const res = await unmergePOST(
      buildPostRequest({ treeId: ws.id, mergedId: "nonexistent" }) as never,
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 if target fragment isn't a merge result", async () => {
    const { ws, fragA } = fixtureWithTwoFragments();
    __seedStore(ws);
    const res = await unmergePOST(
      buildPostRequest({ treeId: ws.id, mergedId: fragA.id }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("merge → unmerge round-trip restores sources", async () => {
    const { ws, fragA, fragB } = fixtureWithTwoFragments();
    __seedStore(ws);
    setClaudeResponse("merged");

    const mergeRes = await mergePOST(
      buildPostRequest({
        treeId: ws.id,
        sourceId: fragA.id,
        targetId: fragB.id,
        mergeType: "append",
      }) as never,
    );
    const { resultId } = await mergeRes.json();
    await flushAsync(50);

    // Verify post-merge state
    const mid = __getStoredWorkspace(ws.id)!;
    expect(mid.fragments[fragA.id].content).toMatch(/^\[merged into/);
    expect(mid.fragments[fragB.id].content).toMatch(/^\[merged into/);

    // Now unmerge
    const unmergeRes = await unmergePOST(
      buildPostRequest({ treeId: ws.id, mergedId: resultId }) as never,
    );
    expect(unmergeRes.status).toBe(200);
    const unmergeBody = await unmergeRes.json();
    expect(unmergeBody.ok).toBe(true);

    const after = __getStoredWorkspace(ws.id)!;
    expect(after.fragments[fragA.id].content).toBe(fragA.content);
    expect(after.fragments[fragB.id].content).toBe(fragB.content);
    expect(after.fragments[resultId]).toBeUndefined();
  });
});
