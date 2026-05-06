import { test, expect } from "./fixtures";

/**
 * Each view is a pure projection of the same workspace. These tests
 * verify rendering behavior — markdown, expand/collapse, the X-ray
 * structure, the split layout — independent of any state mutation.
 */

test.describe("ChatView (X-ray)", () => {
  test.beforeEach(async ({ loomPage }) => {
    // Cycle to chat view via direct shortcut
    const isMac = process.platform === "darwin";
    await loomPage.keyboard.press(isMac ? "Meta+1" : "Control+1");
  });

  test("NEXT assembly shows fragments + token total", async ({ loomPage }) => {
    await expect(loomPage.getByText("next ▸ assembly")).toBeVisible();
    // Token line: "Nk / 900k tokens (X.X%)"
    await expect(loomPage.locator("text=/\\d+(\\.\\d+)?k? \\/ 900k tokens/")).toBeVisible();
  });

  test("HISTORY section shows opLog with op-type labels", async ({ loomPage }) => {
    await expect(loomPage.getByText(/history \(\d+ ops?\)/i)).toBeVisible();
    // At least one ai-gen, merge, or reroll entry should be present
    // (workspaces usually have generation history)
    const opTypes = loomPage.locator("text=/^(ai-gen|merge|reroll|user-typed|split|unmerge)$/i");
    expect(await opTypes.count()).toBeGreaterThan(0);
  });

  test("ai-gen entries are expandable and show prompt", async ({ loomPage }) => {
    const aiGenButton = loomPage.locator("button").filter({ hasText: /^ai-gen/ }).first();
    if (await aiGenButton.count() === 0) {
      test.skip(true, "no ai-generated ops in this workspace");
    }
    await aiGenButton.click();
    // After expand, the "prompt" sub-label should be visible
    await expect(loomPage.getByText("prompt", { exact: true }).first()).toBeVisible();
  });

  test("renders markdown (bold, italic) in fragment content", async ({ loomPage }) => {
    // Find any <strong> or <em> inside the assembly section — proves
    // markdown parsed (rather than rendering raw asterisks)
    const bolds = loomPage.locator("strong");
    const italics = loomPage.locator("em");
    const total = (await bolds.count()) + (await italics.count());
    expect(total).toBeGreaterThan(0);
  });
});

test.describe("ReaderView", () => {
  test.beforeEach(async ({ loomPage }) => {
    const isMac = process.platform === "darwin";
    await loomPage.keyboard.press(isMac ? "Meta+2" : "Control+2");
  });

  test("renders markdown italics inline (no raw asterisks)", async ({ loomPage }) => {
    const italics = loomPage.locator("em");
    if (await italics.count() === 0) {
      test.skip(true, "workspace has no markdown emphasis to verify");
    }
    expect(await italics.count()).toBeGreaterThan(0);

    // Sanity check: the rendered text shouldn't contain raw `*two words*`
    // patterns — those would indicate markdown wasn't parsed.
    const body = await loomPage.locator("body").innerText();
    const rawItalicPattern = /\*[a-z]+ [a-z]+\*/i;
    expect(rawItalicPattern.test(body)).toBe(false);
  });
});

test.describe("TreeView", () => {
  test.beforeEach(async ({ loomPage }) => {
    const isMac = process.platform === "darwin";
    await loomPage.keyboard.press(isMac ? "Meta+3" : "Control+3");
  });

  test("renders nodes with role + token labels in collapsed state", async ({ loomPage }) => {
    // Collapsed cards have a small "Nt" token suffix
    const tokenLabels = loomPage.locator("text=/^\\d+t$/");
    expect(await tokenLabels.count()).toBeGreaterThan(0);

    // Hint text at the bottom
    await expect(
      loomPage.getByText(/click a node to expand · click again to collapse/),
    ).toBeVisible();
  });

  test("clicking a non-system node expands it, exposes 'open in canvas →'", async ({ loomPage }) => {
    const assistantNode = loomPage
      .locator("button")
      .filter({ hasText: /^assistant/ })
      .filter({ hasNotText: /merged into/ })
      .filter({ hasNotText: /split into/ })
      .first();
    if (await assistantNode.count() === 0) {
      test.skip(true, "no expandable assistant nodes in workspace");
    }
    await assistantNode.click();
    // After expand, the 'open in canvas →' button is rendered
    await expect(loomPage.getByRole("button", { name: /open in canvas/ }).first()).toBeVisible();
  });

  test("does NOT trigger button-in-button hydration warning", async ({ loomPage }) => {
    const errors: string[] = [];
    loomPage.on("console", (msg) => {
      if (msg.text().includes("cannot be a descendant of") || msg.text().includes("cannot contain a nested")) {
        errors.push(msg.text());
      }
    });
    // Trigger expand/collapse a few times
    const firstNode = loomPage.locator("button").filter({ hasText: /^assistant/ }).first();
    if (await firstNode.count() > 0) {
      await firstNode.click();
      await firstNode.click();
    }
    await loomPage.waitForTimeout(300);
    expect(errors).toHaveLength(0);
  });
});

test.describe("split layout", () => {
  test("turning split on renders two distinct view panes", async ({ loomPage }) => {
    // Make sure split is OFF first
    const splitToggle = loomPage.getByRole("button", { name: "split" });
    const cycleSelector = /^(canvas|reader|chat|tree) ▸$/;
    const beforeCycleCount = await loomPage
      .getByRole("button", { name: cycleSelector })
      .count();
    if (beforeCycleCount === 2) {
      await splitToggle.click();
    }
    await splitToggle.click();

    const cycles = loomPage.getByRole("button", { name: cycleSelector });
    await expect(cycles).toHaveCount(2);

    // Each cycle should be independently clickable and change only its own
    const labels = await Promise.all(
      Array.from({ length: 2 }).map((_, i) => cycles.nth(i).textContent()),
    );
    await cycles.nth(1).click();
    const after = await cycles.nth(1).textContent();
    expect(after).not.toBe(labels[1]);
  });
});

test.describe("canvas", () => {
  test.beforeEach(async ({ loomPage }) => {
    const isMac = process.platform === "darwin";
    await loomPage.keyboard.press(isMac ? "Meta+4" : "Control+4");
  });

  test("does NOT render empty STAGE box when 0 staged but unplaced alts exist", async ({ loomPage }) => {
    // The stage indicator label "stage" should only be visible when
    // there's something actually staged. A workspace with reroll alts
    // and 0 staged should NOT show the dashed amber box.
    const stat = loomPage.locator("text=/0 staged/");
    if (await stat.count() === 0) {
      test.skip(true, "workspace doesn't have the unplaced-alts-without-staged shape");
    }
    const stageLabel = loomPage.getByText("stage", { exact: true });
    if (await stageLabel.count() > 0) {
      await expect(stageLabel.first()).not.toBeVisible();
    }
  });
});

// ---------------------------------------------------------------------------
// Drag-merge — placeholder (skipped). The current physics-based merge
// detection requires real pointer events with sustained overlap, which
// playwright's drag synthesis doesn't reliably trigger. To make these
// reliable, we'd need either:
//   - A test-only API hook to set merge candidate state directly, OR
//   - Slow real pointer drag using page.mouse.down/move/up with hold,
//     calibrated to the physics MERGE_OVERLAP_MIN threshold.
// Both are real work — leaving structured stubs here for the next pass.
// ---------------------------------------------------------------------------

test.describe.skip("drag-merge gestures", () => {
  test("dropping A onto top edge of B → 'merge ▸ prepend' label appears", async () => {});
  test("dropping A onto bottom edge of B → 'merge ▸ append' label appears", async () => {});
  test("dropping A into body of B → 'merge ▸ insert @ N' label + emerald caret in B", async () => {});
  test("wiggling A during hold updates the live mode + caret offset", async () => {});
  test("releasing after 2s hold fires merge API", async () => {});
});
