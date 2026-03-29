import { NextRequest, NextResponse } from "next/server";
import { getSession, updateSession } from "@/lib/session-store";
import { writeSessionToObsidian } from "@/lib/obsidian";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { sessionId, completionMet } = body as {
    sessionId: string;
    completionMet: boolean;
  };

  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const updated = updateSession(sessionId, {
    status: "completed",
    completionMet,
  });

  if (!updated) {
    return NextResponse.json(
      { error: "Failed to update session" },
      { status: 500 }
    );
  }

  // Write to Obsidian
  let obsidianPath: string | null = null;
  try {
    obsidianPath = await writeSessionToObsidian(updated);
  } catch (err) {
    console.error("Failed to write to Obsidian:", err);
  }

  return NextResponse.json({
    session: updated,
    obsidianPath,
  });
}
