import { NextRequest, NextResponse } from "next/server";
import { getSession, updateSession } from "@/lib/session-store";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { sessionId, newIntent, newCompletionCondition } = body as {
    sessionId: string;
    newIntent: string;
    newCompletionCondition?: string;
  };

  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (session.status !== "active") {
    return NextResponse.json(
      { error: `Session is ${session.status}` },
      { status: 400 }
    );
  }

  // Intent revision costs 1 exchange from budget
  const updated = updateSession(sessionId, {
    intent: newIntent,
    completionCondition: newCompletionCondition ?? session.completionCondition,
    budget: Math.max(1, session.budget - 1),
  });

  return NextResponse.json(updated);
}
