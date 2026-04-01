import { NextRequest, NextResponse } from "next/server";
import { getWorkspace, saveWorkspace } from "@/lib/workspace-store";
import { splitFragment } from "@/lib/workspace";

export async function POST(req: NextRequest) {
  const { treeId, fragmentId, charStart, charEnd } = await req.json();

  if (!treeId || !fragmentId || charStart === undefined || charEnd === undefined) {
    return NextResponse.json({ error: "treeId, fragmentId, charStart, and charEnd are required" }, { status: 400 });
  }

  const ws = getWorkspace(treeId);
  if (!ws) return NextResponse.json({ error: "Tree not found" }, { status: 404 });
  if (!ws.fragments[fragmentId]) return NextResponse.json({ error: "Fragment not found" }, { status: 404 });

  const results = splitFragment(ws, fragmentId, charStart, charEnd);
  if (!results) return NextResponse.json({ error: "Cannot split at this range" }, { status: 400 });

  saveWorkspace(ws);

  return NextResponse.json({
    fragments: results,
    sequence: ws.sequence,
  });
}
