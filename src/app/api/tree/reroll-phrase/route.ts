import { NextRequest, NextResponse } from "next/server";
import { getWorkspace, saveWorkspace } from "@/lib/workspace-store";
import { addFragment, addEdge, getParent } from "@/lib/workspace";
import { queryClaudeCode } from "@/lib/claude";

/**
 * POST /api/tree/reroll-phrase
 *
 * Generate N alternative phrasings for a selected phrase within a node.
 *
 * In ephemeral mode (default true), this is a pure read — no siblings
 * are written, the caller gets just the alternative phrase strings to
 * preview inline. The frontend can then commit one as an in-place edit
 * via /api/tree/edit. This avoids polluting the workspace with five
 * near-duplicate fragments every time the writer asks for a synonym.
 *
 * In non-ephemeral mode, the original behavior persists: each
 * alternative becomes a derived sibling fragment for tree-view review.
 *
 * Body: { treeId, nodeId, selectedText, fullContent, count?, ephemeral? }
 * Returns: { alternatives: string[], siblingNodeIds?: string[], status }
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { treeId, nodeId, selectedText, fullContent, count, ephemeral } = body as {
    treeId: string;
    nodeId: string;
    selectedText: string;
    fullContent: string;
    count?: number;
    ephemeral?: boolean;
  };

  if (!treeId || !nodeId || !selectedText || !fullContent) {
    return NextResponse.json(
      { error: "Missing required fields: treeId, nodeId, selectedText, fullContent" },
      { status: 400 }
    );
  }

  const ws = getWorkspace(treeId);
  if (!ws) {
    return NextResponse.json({ error: "Tree not found" }, { status: 404 });
  }

  const frag = ws.fragments[nodeId];
  if (!frag) {
    return NextResponse.json({ error: "Fragment not found" }, { status: 404 });
  }

  const isEphemeral = ephemeral !== false; // default true going forward
  const parent = isEphemeral ? null : getParent(ws, nodeId, "responded-to");
  if (!isEphemeral && !parent) {
    return NextResponse.json(
      { error: "Cannot reroll phrase on root fragment in persisted mode" },
      { status: 400 }
    );
  }

  const n = count ?? 5;

  // The prompt asks for ONLY the N alternative phrases — not full
  // re-renders of the fragment content. The frontend handles
  // substitution. This keeps the LLM focused, response shorter,
  // and the parsed array compact and easy to display.
  const prompt = `Context (do not rewrite this whole text):\n\n${fullContent}\n\n---\n\nThe phrase to rewrite is: "${selectedText}"\n\nReturn a JSON array of exactly ${n} alternative phrasings of just that phrase, each one a drop-in replacement that fits the surrounding context. No explanation, no full sentences, no markdown. Each array element is just the alternative phrase.`;

  const systemPrompt =
    "You are a writing assistant. You return ONLY valid JSON arrays of short strings — alternative phrasings of a small phrase the user wants to vary. No markdown fences, no explanation, no full-sentence rewrites. Each element is just the alternative phrase that should drop into the context as-is.";

  try {
    const response = await queryClaudeCode(prompt, systemPrompt, [], {
      model: "sonnet",
      noTools: true,
    });

    let alternatives: string[];
    try {
      let cleaned = response.text.trim();
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
      }
      alternatives = JSON.parse(cleaned);
      if (!Array.isArray(alternatives)) {
        throw new Error("Response is not an array");
      }
      // Filter to non-empty strings only, dedupe
      alternatives = Array.from(
        new Set(
          alternatives
            .filter((a) => typeof a === "string")
            .map((a) => a.trim())
            .filter((a) => a.length > 0 && a !== selectedText)
        )
      );
    } catch (parseErr) {
      console.error(
        "[viveka-loom] Failed to parse reroll-phrase response:",
        response.text
      );
      return NextResponse.json(
        {
          error: "Failed to parse AI response as JSON array",
          raw: response.text,
        },
        { status: 502 }
      );
    }

    if (alternatives.length === 0) {
      return NextResponse.json({
        alternatives: [],
        status: "empty",
        message: "Model returned no usable alternatives",
      });
    }

    if (isEphemeral) {
      console.log(
        `[viveka-loom] reroll-phrase ephemeral: ${alternatives.length} alternatives for node ${nodeId.slice(0, 8)}`
      );
      return NextResponse.json({
        alternatives,
        status: "complete",
        message: `${alternatives.length} alternative phrasings`,
      });
    }

    // Persisted path — keep the historical behavior (create derived sibling
    // fragments, each with the FULL content where the phrase has been swapped).
    const siblingNodeIds: string[] = [];
    for (const altPhrase of alternatives) {
      const altContent = fullContent.split(selectedText).join(altPhrase);
      const sibling = addFragment(ws, altContent, {
        type: "derived",
        sourceFragmentIds: [nodeId],
        model: frag.provenance.model,
      });
      if (parent) addEdge(ws, parent.id, sibling.id, "responded-to");
      addEdge(ws, nodeId, sibling.id, "derived");
      siblingNodeIds.push(sibling.id);
    }
    saveWorkspace(ws);

    console.log(
      `[viveka-loom] reroll-phrase persisted: created ${siblingNodeIds.length} sibling fragments for node ${nodeId.slice(0, 8)}`
    );

    return NextResponse.json({
      alternatives,
      siblingNodeIds,
      status: "complete",
      message: `${siblingNodeIds.length} alternative phrasings persisted`,
    });
  } catch (err) {
    console.error("[viveka-loom] reroll-phrase error:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
