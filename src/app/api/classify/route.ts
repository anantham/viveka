import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session-store";
import { classifyExchange } from "@/lib/classifier";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { sessionId, exchangeIndex } = body as {
    sessionId: string;
    exchangeIndex: number;
  };

  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const exchange = session.exchanges[exchangeIndex];
  if (!exchange) {
    return NextResponse.json(
      { error: "Exchange not found" },
      { status: 404 }
    );
  }

  const result = await classifyExchange(
    exchange.userMessage,
    exchange.systemResponse,
    session.intent,
    session.exchanges.slice(Math.max(0, exchangeIndex - 3), exchangeIndex)
  );

  return NextResponse.json(result);
}
