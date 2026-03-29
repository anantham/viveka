import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/session-store";
import { SessionMode } from "@/lib/types";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { intent, completionCondition, mode, budget } = body as {
    intent: string;
    completionCondition: string;
    mode: SessionMode;
    budget?: number;
  };

  if (!intent || !completionCondition || !mode) {
    return NextResponse.json(
      { error: "intent, completionCondition, and mode are required" },
      { status: 400 }
    );
  }

  const session = createSession(intent, completionCondition, mode, budget);
  return NextResponse.json(session);
}
