import { NextRequest, NextResponse } from "next/server";
import { getWorkspace } from "@/lib/workspace-store";
import { workspaceToSession } from "@/lib/workspace-session-adapter";

export async function POST(req: NextRequest) {
  const { treeId } = await req.json();

  if (!treeId) {
    return NextResponse.json({ error: "treeId is required" }, { status: 400 });
  }

  const ws = getWorkspace(treeId);
  if (!ws) {
    return NextResponse.json({ error: "Tree not found" }, { status: 404 });
  }

  const session = workspaceToSession(ws);
  return NextResponse.json(session);
}
