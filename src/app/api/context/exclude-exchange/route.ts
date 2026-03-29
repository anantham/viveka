import { NextRequest, NextResponse } from "next/server";
import { getSession, updateSession } from "@/lib/session-store";

export async function POST(req: NextRequest) {
  const { sessionId, exchangeIndex, excluded } = await req.json();

  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  let excludedExchanges = session.excludedExchanges || [];
  if (excluded && !excludedExchanges.includes(exchangeIndex)) {
    excludedExchanges = [...excludedExchanges, exchangeIndex];
  } else if (!excluded) {
    excludedExchanges = excludedExchanges.filter((i) => i !== exchangeIndex);
  }

  updateSession(sessionId, { excludedExchanges });

  return NextResponse.json({ excludedExchanges });
}
