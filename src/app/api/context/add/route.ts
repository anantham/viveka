import { NextRequest, NextResponse } from "next/server";
import { getSession, updateSession } from "@/lib/session-store";
import { ContextBlock, estimateTokens } from "@/lib/types";
import { v4 as uuidv4 } from "uuid";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { sessionId, name, content, source } = body as {
    sessionId: string;
    name: string;
    content: string;
    source: ContextBlock["source"];
  };

  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const block: ContextBlock = {
    id: uuidv4(),
    name,
    source,
    content,
    charCount: content.length,
    tokenEstimate: estimateTokens(content),
    enabled: true,
    addedAt: new Date().toISOString(),
  };

  const blocks = [...(session.contextBlocks || []), block];
  updateSession(sessionId, { contextBlocks: blocks });

  return NextResponse.json(block);
}
