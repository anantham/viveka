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
  fixtureWithTwoFragments,
  buildPostRequest,
} from "./_helpers";

vi.mock("@/lib/workspace-store", () => workspaceStoreMock());
vi.mock("@/lib/claude", () => claudeMock());

import { POST as swapPOST } from "../swap-phrase/route";

beforeEach(() => {
  __resetStore();
  __resetClaude();
});

describe("/api/tree/swap-phrase", () => {
  it("returns 400 when fields missing", async () => {
    const res = await swapPOST(buildPostRequest({ treeId: "x" }) as never);
    expect(res.status).toBe(400);
  });

  it("literal-single path when phrase appears once (no LLM call)", async () => {
    const { ws, fragA } = fixtureWithTwoFragments();
    // "alpha" appears in "Alpha content alpha" twice (case-insensitive),
    // so we craft a fragment with one occurrence.
    ws.fragments[fragA.id].content = "alpha content here";
    __seedStore(ws);

    const res = await swapPOST(
      buildPostRequest({
        treeId: ws.id,
        fragmentId: fragA.id,
        originalPhrase: "alpha",
        alternativePhrase: "beta",
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.method).toBe("literal-single");
    expect(body.editedContent).toBe("beta content here");
    expect(body.swapCount).toBe(1);
  });

  it("llm-aware path when multiple occurrences", async () => {
    const { ws, fragA } = fixtureWithTwoFragments();
    // fragA.content is "Alpha content alpha" — "alpha" appears twice
    __seedStore(ws);
    setClaudeResponse("Beta content beta");

    const res = await swapPOST(
      buildPostRequest({
        treeId: ws.id,
        fragmentId: fragA.id,
        originalPhrase: "alpha",
        alternativePhrase: "beta",
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.method).toBe("llm-aware");
    // llm-aware passes through the model's response verbatim (modulo
    // the wrapping-quote / fence cleanup). Mocked LLM returned the
    // string with the original capitalization preserved.
    expect(body.editedContent).toBe("Beta content beta");
    expect(body.swapCount).toBe(2);
  });

  it("falls back to literal when LLM returns suspicious length", async () => {
    const { ws, fragA } = fixtureWithTwoFragments();
    __seedStore(ws);
    // 10x larger than original → suspicious
    setClaudeResponse("x".repeat(fragA.content.length * 10));

    const res = await swapPOST(
      buildPostRequest({
        treeId: ws.id,
        fragmentId: fragA.id,
        originalPhrase: "alpha",
        alternativePhrase: "beta",
      }) as never,
    );
    const body = await res.json();
    expect(body.method).toBe("literal-fallback");
    // Replace is case-insensitive on match, case-of-replacement on output:
    // both "Alpha" and "alpha" become the literal "beta".
    expect(body.editedContent).toBe("beta content beta");
    expect(body.warning).toBeTruthy();
  });

  it("falls back to literal on LLM error", async () => {
    const { ws, fragA } = fixtureWithTwoFragments();
    __seedStore(ws);
    setClaudeError(new Error("LLM down"));

    const res = await swapPOST(
      buildPostRequest({
        treeId: ws.id,
        fragmentId: fragA.id,
        originalPhrase: "alpha",
        alternativePhrase: "beta",
      }) as never,
    );
    const body = await res.json();
    expect(body.method).toBe("literal-fallback");
    // Replace is case-insensitive on match, case-of-replacement on output:
    // both "Alpha" and "alpha" become the literal "beta".
    expect(body.editedContent).toBe("beta content beta");
    expect(body.error).toContain("LLM down");
  });

  it("logs a swap-phrase op on EVERY path (X-ray completeness)", async () => {
    // Three calls = three opLog entries
    const { ws, fragA } = fixtureWithTwoFragments();
    __seedStore(ws);

    // Path 1: literal-single
    ws.fragments[fragA.id].content = "alpha here";
    setClaudeResponse(""); // unused for literal-single
    await swapPOST(
      buildPostRequest({
        treeId: ws.id,
        fragmentId: fragA.id,
        originalPhrase: "alpha",
        alternativePhrase: "beta",
      }) as never,
    );

    // Reset content for path 2
    const mid1 = __getStoredWorkspace(ws.id)!;
    mid1.fragments[fragA.id].content = "alpha and alpha";
    setClaudeResponse("beta and beta");

    // Path 2: llm-aware
    await swapPOST(
      buildPostRequest({
        treeId: ws.id,
        fragmentId: fragA.id,
        originalPhrase: "alpha",
        alternativePhrase: "beta",
      }) as never,
    );

    // Path 3: error fallback
    const mid2 = __getStoredWorkspace(ws.id)!;
    mid2.fragments[fragA.id].content = "alpha alpha alpha";
    setClaudeError(new Error("boom"));
    await swapPOST(
      buildPostRequest({
        treeId: ws.id,
        fragmentId: fragA.id,
        originalPhrase: "alpha",
        alternativePhrase: "beta",
      }) as never,
    );

    const after = __getStoredWorkspace(ws.id)!;
    const swapOps = after.opLog.filter((op) => op.type === "swap-phrase");
    expect(swapOps).toHaveLength(3);
    const methods = swapOps.map((op) => (op.type === "swap-phrase" ? op.method : ""));
    expect(methods).toContain("literal-single");
    expect(methods).toContain("llm-aware");
    expect(methods).toContain("literal-fallback");
  });
});
