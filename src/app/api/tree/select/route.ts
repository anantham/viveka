import { NextRequest, NextResponse } from "next/server";
import { getWorkspace, saveWorkspace } from "@/lib/workspace-store";
import { getSiblings, appendToSequence } from "@/lib/workspace";

/**
 * Select a fragment — swaps it with its sibling in the sequence.
 * If the fragment isn't in the sequence, it's added.
 * If a sibling IS in the sequence, the sibling is swapped out.
 * The rest of the sequence is preserved.
 */
export async function POST(req: NextRequest) {
  const { treeId, nodeId } = await req.json();
  const ws = getWorkspace(treeId);
  if (!ws) return NextResponse.json({ error: "Tree not found" }, { status: 404 });

  // If already in sequence, nothing to do
  if (ws.sequence.includes(nodeId)) {
    if (ws.stageIds.includes(nodeId)) {
      ws.stageIds = ws.stageIds.filter((id) => id !== nodeId);
      saveWorkspace(ws);
    }
    return NextResponse.json({ sequence: ws.sequence });
  }

  // Find siblings (fragments sharing the same parent via responded-to edge)
  const siblings = getSiblings(ws, nodeId);
  const siblingIds = siblings.map((s) => s.id);

  // Find which sibling is currently in the sequence
  const currentSibInSeq = ws.sequence.findIndex((id) => siblingIds.includes(id));

  ws.stageIds = ws.stageIds.filter((id) => id !== nodeId);

  if (currentSibInSeq !== -1) {
    // Swap: replace the current sibling with the selected one
    ws.sequence[currentSibInSeq] = nodeId;
  } else {
    // No sibling in sequence — just append
    appendToSequence(ws, nodeId);
  }

  saveWorkspace(ws);
  return NextResponse.json({ sequence: ws.sequence });
}
