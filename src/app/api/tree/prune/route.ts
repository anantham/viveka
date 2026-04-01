import { NextRequest, NextResponse } from "next/server";
import { getWorkspace, saveWorkspace } from "@/lib/workspace-store";
import { removeFromSequence, appendToSequence } from "@/lib/workspace";

export async function POST(req: NextRequest) {
  const { treeId, nodeId, pruned } = await req.json();
  const ws = getWorkspace(treeId);
  if (!ws) return NextResponse.json({ error: "Tree not found" }, { status: 404 });

  if (pruned) {
    removeFromSequence(ws, nodeId);
    ws.opLog.push({ type: "prune", fragmentId: nodeId, timestamp: new Date().toISOString() });
  } else {
    appendToSequence(ws, nodeId);
    ws.opLog.push({ type: "restore", fragmentId: nodeId, timestamp: new Date().toISOString() });
  }
  saveWorkspace(ws);

  return NextResponse.json({ sequence: ws.sequence });
}
