import { NextRequest, NextResponse } from "next/server";
import { getWorkspace, saveWorkspace } from "@/lib/workspace-store";
import { addFragment, addEdge, getParent } from "@/lib/workspace";
import { queryClaudeCode } from "@/lib/claude";

/**
 * POST /api/tree/reroll-phrase
 *
 * Generate N alternative phrasings for a selected phrase within a node.
 * Each alternative creates a sibling node (full copy with only the selected phrase replaced).
 *
 * Body: { treeId, nodeId, selectedText, fullContent, count? }
 * Returns: { siblingNodeIds, status }
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { treeId, nodeId, selectedText, fullContent, count } = body as {
    treeId: string;
    nodeId: string;
    selectedText: string;
    fullContent: string;
    count?: number;
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

  const parent = getParent(ws, nodeId, "responded-to");
  if (!parent) {
    return NextResponse.json(
      { error: "Cannot reroll phrase on root fragment" },
      { status: 400 }
    );
  }

  const n = count ?? 5;

  const prompt = `Given this text:\n\n${fullContent}\n\nRewrite ONLY the phrase '${selectedText}' in ${n} different ways. Return a JSON array of strings, each being the full text with only that phrase replaced. No explanation.`;

  const systemPrompt =
    "You are a writing assistant. You return only valid JSON arrays with no markdown formatting, no code fences, no explanation. Each element is the complete text with the specified phrase replaced by an alternative.";

  // Fire the request (fast model, no tools)
  try {
    const response = await queryClaudeCode(prompt, systemPrompt, [], {
      model: "sonnet",
      noTools: true,
    });

    // Parse the JSON array from the response
    let alternatives: string[];
    try {
      // Strip markdown code fences if present
      let cleaned = response.text.trim();
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
      }
      alternatives = JSON.parse(cleaned);
      if (!Array.isArray(alternatives)) {
        throw new Error("Response is not an array");
      }
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

    // Create sibling fragments for each alternative
    const siblingNodeIds: string[] = [];
    for (const altContent of alternatives) {
      if (typeof altContent !== "string") continue;
      const sibling = addFragment(ws, altContent, {
        type: "derived",
        sourceFragmentIds: [nodeId],
        model: frag.provenance.model,
      });
      addEdge(ws, parent.id, sibling.id, "responded-to");
      addEdge(ws, nodeId, sibling.id, "derived");
      siblingNodeIds.push(sibling.id);
    }

    saveWorkspace(ws);

    console.log(
      `[viveka-loom] reroll-phrase: created ${siblingNodeIds.length} alternatives for node ${nodeId.slice(0, 8)}`
    );

    return NextResponse.json({
      siblingNodeIds,
      status: "complete",
      message: `${siblingNodeIds.length} alternative phrasings created`,
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
