import { NextRequest, NextResponse } from "next/server";
import { getWorkspace, saveWorkspace } from "@/lib/workspace-store";

export async function POST(req: NextRequest) {
  const { treeId, positions } = await req.json();
  const ws = getWorkspace(treeId);
  if (!ws) return NextResponse.json({ error: "Tree not found" }, { status: 404 });

  ws.canvasPositions = { ...ws.canvasPositions, ...positions };
  saveWorkspace(ws);

  return NextResponse.json({ ok: true });
}
