import { NextRequest, NextResponse } from "next/server";
import { getSession, updateSession } from "@/lib/session-store";

export async function POST(req: NextRequest) {
  const { sessionId, blockId } = await req.json();

  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const blocks = (session.contextBlocks || []).filter((b) => b.id !== blockId);
  updateSession(sessionId, { contextBlocks: blocks });

  return NextResponse.json({ removed: true });
}
