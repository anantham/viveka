import { NextRequest, NextResponse } from "next/server";
import { getWorkspace, saveWorkspace } from "@/lib/workspace-store";
import { queryClaudeCode } from "@/lib/claude";

/**
 * POST /api/tree/swap-phrase
 *
 * Apply an alternative phrase across all same-connotation occurrences
 * in a fragment. The user originally selected one occurrence of
 * `originalPhrase` (in some specific connotation); this endpoint asks
 * the LLM to identify other occurrences in the SAME connotation and
 * swap them too — so the writer can preview the effect of a phrase
 * change holistically, not just at the selected spot.
 *
 * Pure read on the workspace — does NOT persist anything. Returns the
 * edited content as a string. The caller (canvas inline preview) decides
 * what to do with it.
 *
 * Body: { treeId, fragmentId, originalPhrase, alternativePhrase }
 * Returns: { editedContent: string, swapCount: number }
 */
export async function POST(req: NextRequest) {
  const { treeId, fragmentId, originalPhrase, alternativePhrase } =
    (await req.json()) as {
      treeId: string;
      fragmentId: string;
      originalPhrase: string;
      alternativePhrase: string;
    };

  if (!treeId || !fragmentId || !originalPhrase || !alternativePhrase) {
    return NextResponse.json(
      {
        error:
          "Missing required fields: treeId, fragmentId, originalPhrase, alternativePhrase",
      },
      { status: 400 },
    );
  }

  const ws = getWorkspace(treeId);
  if (!ws) return NextResponse.json({ error: "Tree not found" }, { status: 404 });

  const frag = ws.fragments[fragmentId];
  if (!frag) {
    return NextResponse.json({ error: "Fragment not found" }, { status: 404 });
  }

  const fullContent = frag.content;

  // Quick exit: if the original phrase only appears once (the selected
  // spot), there's nothing to spread. Return the simple substitution
  // without firing the LLM. Counts case-insensitive whole-word matches.
  const escaped = originalPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const occRe = new RegExp(`\\b${escaped}\\b`, "gi");
  const occurrences = (fullContent.match(occRe) ?? []).length;

  const callStartMs = Date.now();

  // Helper to log every swap attempt to the X-ray, even the cheap
  // literal paths. Each call to this endpoint = one opLog entry.
  const logSwap = (method: string, swapCount: number, capturedPrompt?: string) => {
    const fresh = getWorkspace(treeId);
    if (!fresh) return;
    fresh.opLog.push({
      type: "swap-phrase",
      sourceFragmentId: fragmentId,
      originalPhrase,
      alternativePhrase,
      method,
      swapCount,
      model: fresh.settings.model,
      timestamp: new Date().toISOString(),
      prompt: capturedPrompt,
      durationMs: Date.now() - callStartMs,
    });
    saveWorkspace(fresh);
  };

  if (occurrences <= 1) {
    const edited = fullContent.replace(occRe, alternativePhrase);
    logSwap("literal-single", occurrences);
    return NextResponse.json({
      editedContent: edited,
      swapCount: occurrences,
      method: "literal-single",
    });
  }

  const systemPrompt =
    "You are a careful copyeditor. You preserve every detail of the input except for swapping same-connotation occurrences of a specific phrase. Output ONLY the edited fragment text — no commentary, no preamble, no quotation marks around it, no markdown fences.";

  const prompt = `The writer originally selected the phrase "${originalPhrase}" in the fragment below and chose to replace it with "${alternativePhrase}".

Identify every occurrence of "${originalPhrase}" (and its inflections — plurals, possessives, etc.) that is used in the SAME semantic connotation as the originally-selected one. Replace those with "${alternativePhrase}" (or its grammatically appropriate inflection). Leave occurrences that mean something different in their context UNCHANGED.

Output the fully edited fragment. Preserve all whitespace, punctuation, capitalization at sentence starts, and structure (markdown, line breaks, lists). Output ONLY the edited fragment text.

Fragment:
${fullContent}`;

  try {
    const startMs = Date.now();
    const response = await queryClaudeCode(prompt, systemPrompt, [], {
      model: "sonnet",
      noTools: true,
    });
    const durationMs = Date.now() - startMs;

    let edited = response.text.trim();
    // Strip accidental markdown fences if model wrapped output
    if (edited.startsWith("```")) {
      edited = edited.replace(/^```(?:[a-z]+)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
    }
    // Strip accidental wrapping quotes
    if (
      (edited.startsWith('"') && edited.endsWith('"')) ||
      (edited.startsWith("'") && edited.endsWith("'"))
    ) {
      edited = edited.slice(1, -1);
    }

    // Defensive sanity check: if the model returned something wildly
    // different in length, fall back to literal single swap. The 0.3 / 3x
    // bounds catch hallucinations and truncation while still allowing
    // small inflation/deflation from inflection changes.
    const ratio = edited.length / Math.max(1, fullContent.length);
    if (ratio < 0.3 || ratio > 3) {
      console.warn(
        `[swap-phrase] suspicious length ratio ${ratio.toFixed(2)} — falling back to literal`,
      );
      const fallback = fullContent.replace(occRe, alternativePhrase);
      logSwap("literal-fallback", occurrences, prompt);
      return NextResponse.json({
        editedContent: fallback,
        swapCount: occurrences,
        method: "literal-fallback",
        warning: "LLM returned suspicious length; used literal replace-all",
      });
    }

    console.log(
      `[swap-phrase] DONE in ${durationMs}ms · ${occurrences} occurrences considered`,
    );

    logSwap("llm-aware", occurrences, prompt);
    return NextResponse.json({
      editedContent: edited,
      swapCount: occurrences,
      method: "llm-aware",
    });
  } catch (err) {
    console.error("[swap-phrase] error:", err);
    // Hard fallback to literal replace-all so the UI never gets stuck.
    const fallback = fullContent.replace(occRe, alternativePhrase);
    logSwap("literal-fallback", occurrences, prompt);
    return NextResponse.json({
      editedContent: fallback,
      swapCount: occurrences,
      method: "literal-fallback",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
