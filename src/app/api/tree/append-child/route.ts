import { NextRequest, NextResponse } from "next/server";
import { getWorkspace, saveWorkspace } from "@/lib/workspace-store";
import { addFragment, addEdge, appendToSequence } from "@/lib/workspace";
import type { Provenance } from "@/lib/workspace";

/**
 * POST /api/tree/append-child
 *
 * Append a single new fragment as a child of the given parent and add
 * it to the active sequence. Used when committing the chosen result
 * from an in-place ephemeral preview (extend or reroll). The content
 * is supplied by the caller — no LLM call here, this is a pure write.
 *
 * Body: { treeId, parentId, content, provenance? }
 * Returns: { nodeId, status }
 */
export async function POST(req: NextRequest) {
  const { treeId, parentId, content, provenance } = (await req.json()) as {
    treeId: string;
    parentId: string;
    content: string;
    provenance?: Provenance;
  };

  if (!treeId || !parentId || typeof content !== "string") {
    return NextResponse.json(
      { error: "Missing required fields: treeId, parentId, content" },
      { status: 400 }
    );
  }

  const ws = getWorkspace(treeId);
  if (!ws) return NextResponse.json({ error: "Tree not found" }, { status: 404 });
  if (!ws.fragments[parentId]) {
    return NextResponse.json({ error: "Parent not found" }, { status: 404 });
  }

  const prov: Provenance =
    provenance ?? { type: "ai-generated", model: ws.settings.model };
  const newFrag = addFragment(ws, content, prov);
  addEdge(ws, parentId, newFrag.id, "responded-to");
  appendToSequence(ws, newFrag.id);
  saveWorkspace(ws);

  console.log(
    `[append-child] ${newFrag.id.slice(0, 8)} appended under ${parentId.slice(0, 8)} (${content.length} chars)`
  );

  return NextResponse.json({ nodeId: newFrag.id, status: "complete" });
}
