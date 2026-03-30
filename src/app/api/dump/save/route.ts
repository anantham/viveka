import { NextRequest, NextResponse } from "next/server";
import { getTree, saveTree } from "@/lib/tree-store";
import { addNode, selectNode } from "@/lib/tree";

/**
 * Save a freeform text block to a dump session.
 * Each block becomes a user node in the tree.
 * No AI response — just capture.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { treeId, content, parentId } = body as {
    treeId: string;
    content: string;
    parentId?: string; // if omitted, appends after the last node on active path
  };

  const tree = getTree(treeId);
  if (!tree) {
    return NextResponse.json({ error: "Dump not found" }, { status: 404 });
  }

  // Find parent: explicit, or last node on active path
  const parent = parentId || tree.activePathIds[tree.activePathIds.length - 1];
  if (!parent) {
    return NextResponse.json({ error: "No parent node" }, { status: 400 });
  }

  const node = addNode(tree, parent, "user", content, "human", "complete");
  selectNode(tree, node.id);
  saveTree(tree);

  return NextResponse.json({ node, activePathIds: tree.activePathIds });
}
