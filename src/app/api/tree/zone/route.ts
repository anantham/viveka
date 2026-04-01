import { NextRequest, NextResponse } from "next/server";
import { getWorkspace, saveWorkspace } from "@/lib/workspace-store";
import { moveToStage, moveToWorkspace } from "@/lib/workspace";

export async function POST(req: NextRequest) {
  const { treeId, fragmentId, toZone } = await req.json();

  if (!treeId || !fragmentId || !toZone) {
    return NextResponse.json({ error: "treeId, fragmentId, and toZone are required" }, { status: 400 });
  }

  const ws = getWorkspace(treeId);
  if (!ws) return NextResponse.json({ error: "Tree not found" }, { status: 404 });
  if (!ws.fragments[fragmentId]) return NextResponse.json({ error: "Fragment not found" }, { status: 404 });

  if (toZone === "stage") {
    moveToStage(ws, fragmentId);
  } else if (toZone === "workspace") {
    moveToWorkspace(ws, fragmentId);
  }
  saveWorkspace(ws);

  return NextResponse.json({ sequence: ws.sequence, stageIds: ws.stageIds });
}
