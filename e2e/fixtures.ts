import { test as base, type Page } from "@playwright/test";

/**
 * Shared fixtures.
 *
 * `loomPage` — opens a workspace-canvas page and waits for the canvas
 * to render its initial fragments. The workspace id comes from env
 * (PLAYWRIGHT_WORKSPACE_ID) or a default fixture id baked in below.
 *
 * Tests that mutate state (drag-merge, edits, etc) should fence
 * themselves so they don't leak into the next test — or use a
 * dedicated workspace per spec file.
 */

const DEFAULT_WORKSPACE_ID = process.env.PLAYWRIGHT_WORKSPACE_ID
  ?? "afa73f87-6a29-4c12-84ff-4f771cbfb6dd";

type Fixtures = {
  loomPage: Page;
  workspaceId: string;
};

export const test = base.extend<Fixtures>({
  workspaceId: DEFAULT_WORKSPACE_ID,

  loomPage: async ({ page, workspaceId }, use) => {
    await page.goto(`/loom/${workspaceId}`);
    // Wait until the header is rendered — proxy for "page is ready".
    // The brand link's text node is "Viveka"; CSS uppercases it visually.
    await page.getByRole("link", { name: "Viveka" }).waitFor({ state: "visible" });
    await use(page);
  },
});

export { expect } from "@playwright/test";
