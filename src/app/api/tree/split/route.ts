import { NextRequest, NextResponse } from "next/server";
import { getTree, saveTree } from "@/lib/tree-store";
import { splitNodeAtPosition } from "@/lib/tree";

/**
 * Split a node's content mid-text (tangent/star mode).
 * Truncates the node at charPosition (snapped to word boundary), appends "...",
 * and creates a new empty child node for the user's interruption.
 */
export async function POST(req: NextRequest) {
  const { treeId, nodeId, charPosition } = await req.json();

  if (!treeId || !nodeId || charPosition === undefined) {
    return NextResponse.json(
      { error: "treeId, nodeId, and charPosition are required" },
      { status: 400 }
    );
  }

  const tree = getTree(treeId);
  if (!tree) {
    return NextResponse.json({ error: "Tree not found" }, { status: 404 });
  }

  if (!tree.nodes[nodeId]) {
    return NextResponse.json({ error: "Node not found" }, { status: 404 });
  }

  const result = splitNodeAtPosition(tree, nodeId, charPosition);

  if (!result) {
    return NextResponse.json(
      { error: "Cannot split at this position (too close to start/end or node is empty)" },
      { status: 400 }
    );
  }

  saveTree(tree);

  return NextResponse.json({
    parentNode: result.parentNode,
    childNode: result.childNode,
    activePathIds: tree.activePathIds,
  });
}
