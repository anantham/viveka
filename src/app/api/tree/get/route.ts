import { NextRequest, NextResponse } from "next/server";
import { getWorkspace } from "@/lib/workspace-store";

export async function POST(req: NextRequest) {
  const { id } = await req.json();
  const ws = getWorkspace(id);
  if (!ws) {
    return NextResponse.json({ error: "Tree not found" }, { status: 404 });
  }
  return NextResponse.json(ws);
}
