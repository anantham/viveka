import { NextRequest, NextResponse } from "next/server";
import { getWorkspace, saveWorkspace } from "@/lib/workspace-store";
import { splitFragment } from "@/lib/workspace";

/**
 * Split a fragment mid-text (tangent/star mode).
 * Uses the range split with charStart = charPosition, charEnd = content.length.
 */
export async function POST(req: NextRequest) {
  const { treeId, nodeId, charPosition } = await req.json();

  if (!treeId || !nodeId || charPosition === undefined) {
    return NextResponse.json({ error: "treeId, nodeId, and charPosition are required" }, { status: 400 });
  }

  const ws = getWorkspace(treeId);
  if (!ws) return NextResponse.json({ error: "Tree not found" }, { status: 404 });

  const frag = ws.fragments[nodeId];
  if (!frag) return NextResponse.json({ error: "Fragment not found" }, { status: 404 });

  // Tangent split = split at position to end (produces 2 fragments: before + after)
  const results = splitFragment(ws, nodeId, charPosition, frag.content.length);

  if (!results) {
    return NextResponse.json({ error: "Cannot split at this position (too close to start/end or empty)" }, { status: 400 });
  }

  saveWorkspace(ws);

  return NextResponse.json({
    fragments: results,
    sequence: ws.sequence,
  });
}
