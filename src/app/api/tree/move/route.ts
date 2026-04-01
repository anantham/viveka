import { NextRequest, NextResponse } from "next/server";
import { getWorkspace, saveWorkspace } from "@/lib/workspace-store";
import { moveInSequence } from "@/lib/workspace";

export async function POST(req: NextRequest) {
  const { treeId, fragmentId, toIndex } = await req.json();

  if (!treeId || !fragmentId || toIndex === undefined) {
    return NextResponse.json({ error: "treeId, fragmentId, and toIndex are required" }, { status: 400 });
  }

  const ws = getWorkspace(treeId);
  if (!ws) return NextResponse.json({ error: "Tree not found" }, { status: 404 });
  if (!ws.fragments[fragmentId]) return NextResponse.json({ error: "Fragment not found" }, { status: 404 });

  moveInSequence(ws, fragmentId, toIndex);
  saveWorkspace(ws);

  return NextResponse.json({ sequence: ws.sequence });
}
