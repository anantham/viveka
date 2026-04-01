import { NextRequest, NextResponse } from "next/server";
import { createWorkspace } from "@/lib/workspace";
import { saveWorkspace } from "@/lib/workspace-store";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { intent, completionCondition, mode, settings } = body;

  if (!intent || !completionCondition) {
    return NextResponse.json({ error: "intent and completionCondition required" }, { status: 400 });
  }

  const ws = createWorkspace(intent, completionCondition, mode || "instrumental", settings);
  saveWorkspace(ws);

  return NextResponse.json(ws);
}
