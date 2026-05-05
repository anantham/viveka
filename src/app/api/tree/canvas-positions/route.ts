import { NextRequest, NextResponse } from "next/server";
import { getWorkspace, saveWorkspace } from "@/lib/workspace-store";

export async function POST(req: NextRequest) {
  const { treeId, positions, replace } = await req.json();
  const ws = getWorkspace(treeId);
  if (!ws) return NextResponse.json({ error: "Tree not found" }, { status: 404 });

  ws.canvasPositions = replace
    ? (positions ?? {})
    : { ...ws.canvasPositions, ...positions };
  saveWorkspace(ws);

  return NextResponse.json({ ok: true });
}
