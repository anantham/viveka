import { NextRequest, NextResponse } from "next/server";
import { getSession, updateSession } from "@/lib/session-store";

export async function POST(req: NextRequest) {
  const { sessionId, blockId, enabled } = await req.json();

  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const blocks = (session.contextBlocks || []).map((b) =>
    b.id === blockId ? { ...b, enabled } : b
  );
  updateSession(sessionId, { contextBlocks: blocks });

  return NextResponse.json({ toggled: true });
}
