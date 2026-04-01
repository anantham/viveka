import { NextRequest, NextResponse } from "next/server";
import { getWorkspace, saveWorkspace } from "@/lib/workspace-store";
import { addFragment, addEdge, appendToSequence } from "@/lib/workspace";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { treeId, content, parentId } = body as {
    treeId: string;
    content: string;
    parentId?: string;
  };

  const ws = getWorkspace(treeId);
  if (!ws) return NextResponse.json({ error: "Dump not found" }, { status: 404 });

  const parent = parentId || ws.sequence[ws.sequence.length - 1];
  if (!parent) return NextResponse.json({ error: "No parent fragment" }, { status: 400 });

  const frag = addFragment(ws, content, { type: "human-typed" });
  addEdge(ws, parent, frag.id, "responded-to");
  appendToSequence(ws, frag.id);
  saveWorkspace(ws);

  return NextResponse.json({ node: frag, sequence: ws.sequence });
}
