import { NextRequest, NextResponse } from "next/server";
import { getTree } from "@/lib/tree-store";
import { saveTree } from "@/lib/tree-store";
import { selectNode } from "@/lib/tree";

export async function POST(req: NextRequest) {
  const { treeId, nodeId } = await req.json();
  const tree = getTree(treeId);
  if (!tree) return NextResponse.json({ error: "Tree not found" }, { status: 404 });

  selectNode(tree, nodeId);
  saveTree(tree);

  return NextResponse.json({ activePathIds: tree.activePathIds });
}
