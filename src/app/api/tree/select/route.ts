import { NextRequest, NextResponse } from "next/server";
import { getWorkspace, saveWorkspace } from "@/lib/workspace-store";
import { getChildren, getParent, buildTreeFromEdges } from "@/lib/workspace";

/**
 * Select a fragment — rebuilds the sequence to follow this branch.
 * Walks up to root via edges, then down following first child.
 */
export async function POST(req: NextRequest) {
  const { treeId, nodeId } = await req.json();
  const ws = getWorkspace(treeId);
  if (!ws) return NextResponse.json({ error: "Tree not found" }, { status: 404 });

  // Rebuild sequence from this node's lineage
  // Walk up to root
  const pathUp: string[] = [];
  let current: string | undefined = nodeId;
  while (current) {
    pathUp.unshift(current);
    const parent = getParent(ws, current, "responded-to");
    current = parent?.id;
  }

  // Walk down from nodeId following first child
  current = nodeId;
  while (current) {
    const kids = getChildren(ws, current, "responded-to");
    const firstComplete = kids.find((k) => k.status === "complete" || k.status === "generating");
    if (!firstComplete) break;
    pathUp.push(firstComplete.id);
    current = firstComplete.id;
  }

  ws.sequence = pathUp;
  saveWorkspace(ws);

  return NextResponse.json({ sequence: ws.sequence });
}
