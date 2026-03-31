import { NextRequest, NextResponse } from "next/server";
import { getTree, saveTree } from "@/lib/tree-store";
import { transferZone, getSequence, getFragmentsByZone } from "@/lib/tree";
import type { FragmentZone } from "@/lib/tree";

/**
 * Transfer a fragment between workspace and stage zones.
 */
export async function POST(req: NextRequest) {
  const { treeId, fragmentId, toZone } = await req.json();

  if (!treeId || !fragmentId || !toZone) {
    return NextResponse.json(
      { error: "treeId, fragmentId, and toZone are required" },
      { status: 400 }
    );
  }

  if (!["workspace", "stage", "pruned"].includes(toZone)) {
    return NextResponse.json(
      { error: "toZone must be 'workspace', 'stage', or 'pruned'" },
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

  transferZone(tree, fragmentId, toZone as FragmentZone);
  saveTree(tree);

  return NextResponse.json({
    sequence: getSequence(tree),
    staged: getFragmentsByZone(tree, "stage").map((n) => n.id),
  });
}
