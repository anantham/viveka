import { vi } from "vitest";
import { createWorkspace, type Workspace } from "@/lib/workspace";

/**
 * In-memory workspace store for route tests. Replaces the fs-backed
 * workspace-store module via vi.mock at the top of each test file.
 *
 * Usage:
 *   import { __resetStore, __seedStore } from "./_helpers";
 *   vi.mock("@/lib/workspace-store", async () => import("./_helpers").then(m => m.workspaceStoreMock()));
 */

let store: Record<string, Workspace> = {};

export function __resetStore() {
  store = {};
}

export function __seedStore(ws: Workspace) {
  store[ws.id] = ws;
}

export function __getStoredWorkspace(id: string): Workspace | undefined {
  return store[id];
}

export const workspaceStoreMock = () => ({
  getWorkspace: vi.fn((id: string) => store[id]),
  saveWorkspace: vi.fn((ws: Workspace) => {
    store[ws.id] = ws;
  }),
  listWorkspaces: vi.fn(() => Object.values(store)),
  deleteWorkspace: vi.fn((id: string) => {
    if (!(id in store)) return false;
    delete store[id];
    return true;
  }),
});

/**
 * Build a Workspace fixture with two sequenced human-typed fragments
 * for tests that need a merge-able pair.
 */
export function fixtureWithTwoFragments(): {
  ws: Workspace;
  fragA: { id: string; content: string };
  fragB: { id: string; content: string };
} {
  const ws = createWorkspace("test intent", "done", "draft");
  const rootId = ws.sequence[0];

  // Add two complete fragments in sequence (besides the system root)
  const aId = "frag-a-id";
  const bId = "frag-b-id";
  ws.fragments[aId] = {
    id: aId,
    content: "Alpha content alpha",
    provenance: { type: "human-typed" },
    createdAt: new Date().toISOString(),
    status: "complete",
    version: 1,
    previousVersions: [],
  };
  ws.fragments[bId] = {
    id: bId,
    content: "Beta content beta",
    provenance: { type: "human-typed" },
    createdAt: new Date().toISOString(),
    status: "complete",
    version: 1,
    previousVersions: [],
  };
  ws.sequence.push(aId, bId);
  ws.edges.push({ from: rootId, to: aId, type: "responded-to" });
  ws.edges.push({ from: aId, to: bId, type: "responded-to" });

  return {
    ws,
    fragA: { id: aId, content: "Alpha content alpha" },
    fragB: { id: bId, content: "Beta content beta" },
  };
}

/**
 * Mock for src/lib/claude. Tests can configure the response via
 * setClaudeResponse / setClaudeError before triggering the route.
 */
let claudeResponseText = "MOCK MERGED CONTENT";
let claudeError: Error | null = null;
let claudeCalls: Array<{ prompt: string; system: string; model?: string }> = [];

export function setClaudeResponse(text: string) {
  claudeResponseText = text;
  claudeError = null;
}

export function setClaudeError(err: Error) {
  claudeError = err;
}

export function getClaudeCalls() {
  return [...claudeCalls];
}

export function __resetClaude() {
  claudeResponseText = "MOCK MERGED CONTENT";
  claudeError = null;
  claudeCalls = [];
}

export const claudeMock = () => ({
  queryClaudeCode: vi.fn(async (prompt: string, system: string, _hist: unknown, opts?: { model?: string }) => {
    claudeCalls.push({ prompt, system, model: opts?.model });
    if (claudeError) throw claudeError;
    return {
      text: claudeResponseText,
      usage: { inputTokens: 100, outputTokens: 50 },
    };
  }),
});

/** Build a minimal NextRequest-like object for POST handlers. */
export function buildPostRequest(body: unknown): Request {
  return new Request("http://localhost:3000/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Wait for any pending fire-and-forget async work to settle. */
export async function flushAsync(ms = 50) {
  await new Promise((r) => setTimeout(r, ms));
}
