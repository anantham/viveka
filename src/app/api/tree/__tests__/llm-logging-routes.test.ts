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
  flushAsync,
} from "./_helpers";

vi.mock("@/lib/workspace-store", () => workspaceStoreMock());
vi.mock("@/lib/claude", () => claudeMock());

import { POST as generatePOST } from "../generate/route";
import { POST as draftPOST } from "../draft/route";

beforeEach(() => {
  __resetStore();
  __resetClaude();
});

describe("/api/tree/generate — opLog logging", () => {
  it("persisted: logs an ai-generated op per completed fragment with prompt + duration", async () => {
    const { ws, fragA } = fixtureWithTwoFragments();
    __seedStore(ws);
    setClaudeResponse("generated reply");

    const res = await generatePOST(
      buildPostRequest({
        treeId: ws.id,
        parentId: fragA.id,
        count: 2,
      }) as never,
    );
    expect(res.status).toBe(200);

    await flushAsync(80);

    const after = __getStoredWorkspace(ws.id)!;
    const aiOps = after.opLog.filter((op) => op.type === "ai-generated");
    expect(aiOps.length).toBe(2);
    for (const op of aiOps) {
      if (op.type !== "ai-generated") continue;
      expect(op.fragmentId).toBeTruthy();
      expect(op.ephemeral).toBeFalsy();
      expect(op.prompt).toBeTruthy();
      expect(op.model).toBeTruthy();
      expect(op.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("ephemeral: logs N ai-generated ops marked ephemeral, NO new fragments", async () => {
    const { ws, fragA } = fixtureWithTwoFragments();
    __seedStore(ws);
    setClaudeResponse("alt");

    const fragmentCountBefore = Object.keys(ws.fragments).length;

    const res = await generatePOST(
      buildPostRequest({
        treeId: ws.id,
        parentId: fragA.id,
        count: 3,
        ephemeral: true,
      }) as never,
    );
    const body = await res.json();
    expect(body.alternatives.length).toBeGreaterThan(0);

    const after = __getStoredWorkspace(ws.id)!;
    expect(Object.keys(after.fragments).length).toBe(fragmentCountBefore);

    const ephOps = after.opLog.filter(
      (op) => op.type === "ai-generated" && op.ephemeral,
    );
    expect(ephOps.length).toBe(3);
  });
});

describe("/api/tree/draft — opLog logging", () => {
  it("logs ONE draft op per batch with prompt template + N result ids", async () => {
    const { ws, fragA } = fixtureWithTwoFragments();
    __seedStore(ws);
    setClaudeResponse("draft text");

    const res = await draftPOST(
      buildPostRequest({
        treeId: ws.id,
        parentId: fragA.id,
        count: 3,
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nodeIds.length).toBe(3);

    await flushAsync(80);

    const after = __getStoredWorkspace(ws.id)!;
    const draftOps = after.opLog.filter((op) => op.type === "draft");
    expect(draftOps.length).toBe(1);
    if (draftOps[0]?.type === "draft") {
      expect(draftOps[0].parentId).toBe(fragA.id);
      expect(draftOps[0].resultIds).toEqual(body.nodeIds);
      expect(draftOps[0].prompt).toContain("draft");
      expect(draftOps[0].model).toBeTruthy();
    }
  });
});

// /api/expand — skipped because the route assembles userText only
// from human-typed fragments, and the fixture's fragments are
// human-typed but the route's logic depends on system-prompt
// assembly that's hard to mock without firing the real LLM. Add
// when needed.
