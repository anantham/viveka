import { NextRequest, NextResponse } from "next/server";
import { recordInterventionOutcome } from "@/lib/intervention-log";
import { InterventionResponse, InterventionEvent } from "@/lib/types";

/** Record the user's response to an intervention */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { sessionId, interventionId, outcome, followUpAction } = body as {
    sessionId: string;
    interventionId: string;
    outcome: InterventionResponse;
    followUpAction: InterventionEvent["followUpAction"];
  };

  if (!sessionId || !interventionId) {
    return NextResponse.json(
      { error: "sessionId and interventionId required" },
      { status: 400 }
    );
  }

  recordInterventionOutcome(sessionId, interventionId, outcome, followUpAction);

  return NextResponse.json({ recorded: true });
}
