import { NextRequest, NextResponse } from "next/server";
import { getWorkspace, saveWorkspace } from "@/lib/workspace-store";
import { updateFragmentContent } from "@/lib/workspace";

export async function POST(req: NextRequest) {
  const { treeId, nodeId, content } = await req.json();
  const ws = getWorkspace(treeId);
  if (!ws) return NextResponse.json({ error: "Tree not found" }, { status: 404 });

  updateFragmentContent(ws, nodeId, content);
  saveWorkspace(ws);

  return NextResponse.json({ node: ws.fragments[nodeId] });
}
