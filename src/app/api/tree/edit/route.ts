import { NextRequest, NextResponse } from "next/server";
import { getTree, saveTree } from "@/lib/tree-store";
import { updateNodeContent } from "@/lib/tree";

export async function POST(req: NextRequest) {
  const { treeId, nodeId, content } = await req.json();
  const tree = getTree(treeId);
  if (!tree) return NextResponse.json({ error: "Tree not found" }, { status: 404 });

  updateNodeContent(tree, nodeId, content);
  saveTree(tree);

  return NextResponse.json({ node: tree.nodes[nodeId] });
}
