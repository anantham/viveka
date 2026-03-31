import { NextRequest, NextResponse } from "next/server";
import { getTree, saveTree } from "@/lib/tree-store";
import { splitFragmentAtRange } from "@/lib/tree";

/**
 * Split a fragment at a text selection range.
 * Produces 2 or 3 new fragments depending on selection position.
 */
export async function POST(req: NextRequest) {
  const { treeId, fragmentId, charStart, charEnd } = await req.json();

  if (!treeId || !fragmentId || charStart === undefined || charEnd === undefined) {
    return NextResponse.json(
      { error: "treeId, fragmentId, charStart, and charEnd are required" },
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

  const results = splitFragmentAtRange(tree, fragmentId, charStart, charEnd);

  if (!results) {
    return NextResponse.json(
      { error: "Cannot split at this range" },
      { status: 400 }
    );
  }

  saveTree(tree);

  return NextResponse.json({
    fragments: results,
    sequence: tree.sequence,
    activePathIds: tree.activePathIds,
  });
}
