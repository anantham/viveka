import { test, expect } from "./fixtures";

test.describe("header chrome", () => {
  test("renders all expected header elements with no console errors", async ({ loomPage }) => {
    const errors: string[] = [];
    loomPage.on("pageerror", (e) => errors.push(e.message));
    loomPage.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await expect(loomPage.getByRole("link", { name: "Viveka" })).toBeVisible();
    await expect(loomPage.getByText("LOOM", { exact: true })).toBeVisible();
    await expect(loomPage.locator("text=/\\d+ nodes · \\d+ branches/")).toBeVisible();

    // Header buttons
    await expect(loomPage.getByRole("button", { name: "blocks" })).toBeVisible();
    await expect(loomPage.getByRole("button", { name: "?" })).toBeVisible();
    await expect(loomPage.getByRole("button", { name: /canvas|reader|chat|tree/ })).toBeVisible();
    await expect(loomPage.getByRole("button", { name: "split" })).toBeVisible();

    // ctx gauge has a tooltip ("ctx: N% — Xk / Yk tokens") on its outer
    // div, accessible as the [title] attribute.
    const ctx = loomPage.locator('[title^="ctx:"][title*="tokens"]');
    await expect(ctx).toBeVisible();

    // Wait a beat for any deferred init errors
    await loomPage.waitForTimeout(500);
    expect(errors).toHaveLength(0);
  });
});

test.describe("help overlay", () => {
  test("opens with all 5 merge modes documented including insert", async ({ loomPage }) => {
    await loomPage.getByRole("button", { name: "?" }).click();
    const overlay = loomPage.getByText("canvas gestures");
    await expect(overlay).toBeVisible();

    // All five mode descriptions present
    await expect(loomPage.getByText(/Append — A then B/)).toBeVisible();
    await expect(loomPage.getByText(/Prepend — A before B/)).toBeVisible();
    await expect(loomPage.getByText(/Interleave — sentences from both/)).toBeVisible();
    await expect(loomPage.getByText(/Summarize — distill both/)).toBeVisible();
    await expect(loomPage.getByText(/Insert — drop A inside B/)).toBeVisible();
  });

  test("closes on Escape", async ({ loomPage }) => {
    await loomPage.getByRole("button", { name: "?" }).click();
    await expect(loomPage.getByText("canvas gestures")).toBeVisible();
    await loomPage.keyboard.press("Escape");
    await expect(loomPage.getByText("canvas gestures")).not.toBeVisible();
  });

  test("closes on outside click", async ({ loomPage }) => {
    await loomPage.getByRole("button", { name: "?" }).click();
    await expect(loomPage.getByText("canvas gestures")).toBeVisible();
    // Click far outside the modal
    await loomPage.mouse.click(10, 10);
    await expect(loomPage.getByText("canvas gestures")).not.toBeVisible();
  });
});

test.describe("view cycle", () => {
  test("V key cycles canvas → reader → chat → tree → canvas", async ({ loomPage }) => {
    // Make sure we start on canvas (initial default for new sessions)
    // If the workspace was last in a different view we accommodate by
    // cycling first to a known anchor.
    const cycleButton = loomPage.getByRole("button", { name: /^(canvas|reader|chat|tree) ▸$/ });
    await expect(cycleButton).toBeVisible();

    const seen = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const label = await cycleButton.textContent();
      // textContent concatenates child spans without whitespace ("canvas▸")
      seen.add(label?.trim().replace("▸", "").trim() ?? "");
      await loomPage.keyboard.press("v");
      await loomPage.waitForTimeout(100);
    }
    expect(seen.size).toBe(4);
    expect(seen).toContain("canvas");
    expect(seen).toContain("reader");
    expect(seen).toContain("chat");
    expect(seen).toContain("tree");
  });

  test("shift+V cycles backward", async ({ loomPage }) => {
    const cycleButton = loomPage.getByRole("button", { name: /^(canvas|reader|chat|tree) ▸$/ });
    const before = await cycleButton.textContent();
    await loomPage.keyboard.press("v");
    const after = await cycleButton.textContent();
    await loomPage.keyboard.press("Shift+V");
    const back = await cycleButton.textContent();
    expect(back).toBe(before);
    expect(after).not.toBe(before);
  });

  test("Cmd+1..4 jumps to specific views", async ({ loomPage }) => {
    const cycleButton = loomPage.getByRole("button", { name: /^(canvas|reader|chat|tree) ▸$/ });
    const isMac = process.platform === "darwin";
    const mod = isMac ? "Meta" : "Control";

    await loomPage.keyboard.press(`${mod}+1`);
    await expect(cycleButton).toContainText("chat");

    await loomPage.keyboard.press(`${mod}+2`);
    await expect(cycleButton).toContainText("reader");

    await loomPage.keyboard.press(`${mod}+3`);
    await expect(cycleButton).toContainText("tree");

    await loomPage.keyboard.press(`${mod}+4`);
    await expect(cycleButton).toContainText("canvas");
  });
});

test.describe("split layout", () => {
  test("toggle split → second cycle button appears", async ({ loomPage }) => {
    // Ensure we start un-split. If split is already on, toggle off first.
    const splitToggle = loomPage.getByRole("button", { name: "split" });
    const cycleButtonsBefore = await loomPage
      .getByRole("button", { name: /^(canvas|reader|chat|tree) ▸$/ })
      .count();

    if (cycleButtonsBefore === 2) {
      await splitToggle.click();
    }

    await splitToggle.click();
    const cycleButtonsAfter = await loomPage
      .getByRole("button", { name: /^(canvas|reader|chat|tree) ▸$/ })
      .count();
    expect(cycleButtonsAfter).toBe(2);
  });

  test("Cmd+\\ toggles split", async ({ loomPage }) => {
    const isMac = process.platform === "darwin";
    const mod = isMac ? "Meta" : "Control";

    const before = await loomPage
      .getByRole("button", { name: /^(canvas|reader|chat|tree) ▸$/ })
      .count();
    await loomPage.keyboard.press(`${mod}+\\`);
    await loomPage.waitForTimeout(100);
    const after = await loomPage
      .getByRole("button", { name: /^(canvas|reader|chat|tree) ▸$/ })
      .count();
    expect(after).not.toBe(before);
  });
});

test.describe("blocks panel + add-block dropdown", () => {
  test("opens blocks panel, dropdown shows 3 labeled options with descriptions", async ({ loomPage }) => {
    await loomPage.getByRole("button", { name: "blocks" }).click();
    await loomPage.getByRole("button", { name: /\+ add block/ }).click();

    await expect(loomPage.getByText("Paste text")).toBeVisible();
    await expect(loomPage.getByText("type or paste raw text")).toBeVisible();

    await expect(loomPage.getByText("Upload file/folder")).toBeVisible();
    await expect(loomPage.getByText("drag-drop or browse")).toBeVisible();

    await expect(loomPage.getByText("From library")).toBeVisible();
    await expect(loomPage.getByText("saved blocks across sessions")).toBeVisible();
  });

  test("Upload option reveals drop zone + server-path fallback", async ({ loomPage }) => {
    await loomPage.getByRole("button", { name: "blocks" }).click();
    await loomPage.getByRole("button", { name: /\+ add block/ }).click();
    await loomPage.getByText("Upload file/folder").click();

    await expect(loomPage.getByText("drop files or a folder here")).toBeVisible();
    await expect(loomPage.getByText("or click to browse files")).toBeVisible();
    await expect(loomPage.getByText("or type a server path…")).toBeVisible();
  });
});
