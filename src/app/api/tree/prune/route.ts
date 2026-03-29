import { NextRequest, NextResponse } from "next/server";
import { getTree, saveTree } from "@/lib/tree-store";
import { pruneNode, unpruneNode } from "@/lib/tree";

export async function POST(req: NextRequest) {
  const { treeId, nodeId, pruned } = await req.json();
  const tree = getTree(treeId);
  if (!tree) return NextResponse.json({ error: "Tree not found" }, { status: 404 });

  if (pruned) {
    pruneNode(tree, nodeId);
  } else {
    unpruneNode(tree, nodeId);
  }
  saveTree(tree);

  return NextResponse.json({ activePathIds: tree.activePathIds });
}
