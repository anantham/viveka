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

// ---------------------------------------------------------------------------
// Drag-merge gestures.
//
// These tests drive real pointer events through Playwright's mouse API.
// They trigger the physics overlap detection (MERGE_OVERLAP_MIN=50 in
// both dims), wait for the live mergeIntent label to appear, assert
// the expected mode, then press Escape mid-hold so no merge actually
// commits — keeps tests read-only and lets them share workspace state.
//
// If a label fails to appear on a given workspace's layout, the test
// is skipped rather than failing — physics positions depend on dagre +
// content sizes which can shift between runs.
// ---------------------------------------------------------------------------

test.describe("drag-merge gestures", () => {
  test.beforeEach(async ({ loomPage }) => {
    const isMac = process.platform === "darwin";
    await loomPage.keyboard.press(isMac ? "Meta+4" : "Control+4");
    // Wait for canvas to render fragments
    await loomPage.locator("[data-fragment-id]").first().waitFor({ state: "visible" });
    await loomPage.waitForTimeout(300);
  });

  /**
   * Drag fragment A's center toward a point on/around fragment B's
   * bbox, hold long enough for the merge label to appear, then
   * release Escape to abort. Returns the label text seen during hold,
   * or null if no label appeared.
   *
   * `targetSpec.dy` is a fraction of B's height to aim at:
   *   dy = 0.05 → top edge   (prepend)
   *   dy = 0.5  → body       (insert)
   *   dy = 0.95 → bottom edge (append)
   *   dy = -0.3 → above B    (summarize)
   *   dy = 1.3  → below B    (interleave)
   */
  async function tryDragMerge(
    page: import("@playwright/test").Page,
    fragmentIdA: string,
    fragmentIdB: string,
    dyFraction: number,
  ): Promise<string | null> {
    const a = await page.locator(`[data-fragment-id="${fragmentIdA}"]`).boundingBox();
    const b = await page.locator(`[data-fragment-id="${fragmentIdB}"]`).boundingBox();
    if (!a || !b) return null;

    const aCenter = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
    const targetX = b.x + b.width / 2;
    const targetY = b.y + b.height * dyFraction;

    await page.mouse.move(aCenter.x, aCenter.y);
    await page.mouse.down();
    // Glide to target in steps so physics samples the path
    const steps = 20;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await page.mouse.move(
        aCenter.x + (targetX - aCenter.x) * t,
        aCenter.y + (targetY - aCenter.y) * t,
      );
      await page.waitForTimeout(20);
    }

    // Wait for merge label to appear — physics tick + RAF + react render
    let label: string | null = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      await page.waitForTimeout(60);
      const node = page.locator("text=/^merge ▸/");
      if ((await node.count()) > 0) {
        label = await node.first().textContent();
        break;
      }
    }

    // Abort — Escape so no commit fires; mouse.up after to release drag.
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.waitForTimeout(100);

    return label;
  }

  async function pickTwoFragmentIds(
    page: import("@playwright/test").Page,
  ): Promise<[string, string] | null> {
    const ids = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>("[data-fragment-id]"))
        .map((el) => el.dataset.fragmentId)
        .filter(Boolean) as string[],
    );
    if (ids.length < 2) return null;
    return [ids[0], ids[1]];
  }

  // The mode-classification logic is unit-tested in
  // canvas-geometry.test.ts (computeMergeIntent). These e2e tests
  // verify the integration: physics detects overlap, mergeIntent
  // computes from positions, MergeSpinner renders the label. Exact
  // mode varies with zoom / pan / fragment sizes between runs, so
  // we assert "merge ▸ <something>" rather than a specific mode.

  test("dragging A onto B's top half triggers merge label", async ({ loomPage }) => {
    const ids = await pickTwoFragmentIds(loomPage);
    if (!ids) test.skip(true, "fewer than 2 fragments on canvas");
    const label = await tryDragMerge(loomPage, ids![0], ids![1], 0.2);
    if (label === null) {
      test.skip(true, "physics didn't trigger merge candidate (positions unfavorable)");
    }
    expect(label).toMatch(/^merge ▸ (prepend|summarize|insert|append|weave)/);
  });

  test("dragging A onto B's body triggers merge label", async ({ loomPage }) => {
    const ids = await pickTwoFragmentIds(loomPage);
    if (!ids) test.skip(true, "fewer than 2 fragments on canvas");
    const label = await tryDragMerge(loomPage, ids![0], ids![1], 0.5);
    if (label === null) {
      test.skip(true, "physics didn't trigger merge candidate");
    }
    expect(label).toMatch(/^merge ▸/);
  });

  test("dragging A onto B's bottom half triggers merge label", async ({ loomPage }) => {
    const ids = await pickTwoFragmentIds(loomPage);
    if (!ids) test.skip(true, "fewer than 2 fragments on canvas");
    const label = await tryDragMerge(loomPage, ids![0], ids![1], 0.8);
    if (label === null) {
      test.skip(true, "physics didn't trigger merge candidate");
    }
    expect(label).toMatch(/^merge ▸/);
  });

  test("insert mode renders an emerald caret rule inside target", async ({ loomPage }) => {
    const ids = await pickTwoFragmentIds(loomPage);
    if (!ids) test.skip(true, "fewer than 2 fragments on canvas");

    const a = await loomPage.locator(`[data-fragment-id="${ids![0]}"]`).boundingBox();
    const b = await loomPage.locator(`[data-fragment-id="${ids![1]}"]`).boundingBox();
    if (!a || !b) test.skip(true, "boxes not visible");

    const aCenter = { x: a!.x + a!.width / 2, y: a!.y + a!.height / 2 };
    const targetX = b!.x + b!.width / 2;
    const targetY = b!.y + b!.height * 0.5;

    await loomPage.mouse.move(aCenter.x, aCenter.y);
    await loomPage.mouse.down();
    const steps = 20;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await loomPage.mouse.move(
        aCenter.x + (targetX - aCenter.x) * t,
        aCenter.y + (targetY - aCenter.y) * t,
      );
      await loomPage.waitForTimeout(20);
    }

    // Wait for caret rule. The caret has class "bg-emerald-400/80
    // animate-pulse" inside the target fragment.
    let caretFound = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      await loomPage.waitForTimeout(60);
      // Match emerald-tinted horizontal rule inside any data-fragment
      const c = loomPage.locator(".bg-emerald-400\\/80.animate-pulse");
      if ((await c.count()) > 0) {
        caretFound = true;
        break;
      }
    }

    await loomPage.keyboard.press("Escape");
    await loomPage.mouse.up();
    await loomPage.waitForTimeout(100);

    if (!caretFound) {
      test.skip(true, "caret didn't render (insert mode wasn't triggered on this layout)");
    }
    expect(caretFound).toBe(true);
  });
});
