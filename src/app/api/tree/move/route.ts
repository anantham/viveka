import { NextRequest, NextResponse } from "next/server";
import { getTree, saveTree } from "@/lib/tree-store";
import { moveFragment, getSequence } from "@/lib/tree";

/**
 * Move a fragment to a new position in the reading order.
 */
export async function POST(req: NextRequest) {
  const { treeId, fragmentId, toIndex } = await req.json();

  if (!treeId || !fragmentId || toIndex === undefined) {
    return NextResponse.json(
      { error: "treeId, fragmentId, and toIndex are required" },
      { status: 400 }
    );
  }

  const tree = getTree(treeId);
  if (!tree) {
    return NextResponse.json({ error: "Tree not found" }, { status: 404 });
  }

  if (!tree.nodes[fragmentId]) {
    return NextResponse.json({ error: "Fragment not found" }, { status: 404 });
  }

  moveFragment(tree, fragmentId, toIndex);
  saveTree(tree);

  return NextResponse.json({
    sequence: getSequence(tree),
  });
}
