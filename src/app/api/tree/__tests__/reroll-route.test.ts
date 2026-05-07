import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  __resetStore,
  __seedStore,
  __getStoredWorkspace,
  workspaceStoreMock,
  claudeMock,
  __resetClaude,
  setClaudeResponse,
  fixtureWithTwoFragments,
  buildPostRequest,
} from "./_helpers";

vi.mock("@/lib/workspace-store", () => workspaceStoreMock());
vi.mock("@/lib/claude", () => claudeMock());

import { POST as rerollPOST } from "../reroll-phrase/route";

beforeEach(() => {
  __resetStore();
  __resetClaude();
});

describe("/api/tree/reroll-phrase", () => {
  it("returns 400 when required fields missing", async () => {
    const res = await rerollPOST(buildPostRequest({}) as never);
    expect(res.status).toBe(400);
  });

  it("returns 404 when fragment not found", async () => {
    const { ws } = fixtureWithTwoFragments();
    __seedStore(ws);
    const res = await rerollPOST(
      buildPostRequest({
        treeId: ws.id,
        nodeId: "missing",
        selectedText: "alpha",
        fullContent: "alpha beta",
      }) as never,
    );
    expect(res.status).toBe(404);
  });

  it("ephemeral mode: returns alternatives without persisting fragments", async () => {
    const { ws, fragA } = fixtureWithTwoFragments();
    __seedStore(ws);
    setClaudeResponse('["resistance", "drag", "guardrails"]');

    const res = await rerollPOST(
      buildPostRequest({
        treeId: ws.id,
        nodeId: fragA.id,
        selectedText: "Alpha",
        fullContent: fragA.content,
        ephemeral: true,
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alternatives).toEqual(["resistance", "drag", "guardrails"]);

    // No new fragments should have been added
    const after = __getStoredWorkspace(ws.id)!;
    const newFragments = Object.keys(after.fragments).filter(
      (id) => !ws.fragments[id],
    );
    expect(newFragments).toHaveLength(0);
  });

  it("ephemeral mode: logs a reroll op with prompt + selectedText (X-ray)", async () => {
    const { ws, fragA } = fixtureWithTwoFragments();
    __seedStore(ws);
    setClaudeResponse('["resistance", "drag"]');

    await rerollPOST(
      buildPostRequest({
        treeId: ws.id,
        nodeId: fragA.id,
        selectedText: "alpha",
        fullContent: fragA.content,
        ephemeral: true,
      }) as never,
    );

    const after = __getStoredWorkspace(ws.id)!;
    const rerollOp = after.opLog.find((op) => op.type === "reroll");
    expect(rerollOp).toBeDefined();
    if (rerollOp?.type === "reroll") {
      expect(rerollOp.selectedText).toBe("alpha");
      expect(rerollOp.prompt).toContain("alpha");
      expect(rerollOp.resultIds).toEqual([]); // ephemeral
    }
  });

  it("filters out alternatives containing the original phrase as a token", async () => {
    const { ws, fragA } = fixtureWithTwoFragments();
    __seedStore(ws);
    // Model returns one bad ("intentional friction" includes "friction") + good ones
    setClaudeResponse('["intentional friction", "resistance", "guardrails"]');

    const res = await rerollPOST(
      buildPostRequest({
        treeId: ws.id,
        nodeId: fragA.id,
        selectedText: "friction",
        fullContent: "Alpha friction here",
        ephemeral: true,
      }) as never,
    );
    const body = await res.json();
    expect(body.alternatives).toEqual(["resistance", "guardrails"]);
    expect(body.alternatives).not.toContain("intentional friction");
  });

  it("returns empty alternatives gracefully when filter eliminates all", async () => {
    const { ws, fragA } = fixtureWithTwoFragments();
    __seedStore(ws);
    setClaudeResponse('["alpha", "Alpha", "ALPHA"]'); // all match selected word

    const res = await rerollPOST(
      buildPostRequest({
        treeId: ws.id,
        nodeId: fragA.id,
        selectedText: "alpha",
        fullContent: fragA.content,
        ephemeral: true,
      }) as never,
    );
    const body = await res.json();
    expect(body.status).toBe("empty");
    expect(body.alternatives).toEqual([]);
  });

  it("returns 502 when LLM returns non-JSON", async () => {
    const { ws, fragA } = fixtureWithTwoFragments();
    __seedStore(ws);
    setClaudeResponse("not json at all");

    const res = await rerollPOST(
      buildPostRequest({
        treeId: ws.id,
        nodeId: fragA.id,
        selectedText: "alpha",
        fullContent: fragA.content,
      }) as never,
    );
    expect(res.status).toBe(502);
  });
});
