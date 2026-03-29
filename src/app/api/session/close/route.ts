import { NextRequest, NextResponse } from "next/server";
import { getSession, updateSession } from "@/lib/session-store";
import { writeSessionToObsidian } from "@/lib/obsidian";
import { SessionStatus } from "@/lib/types";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { sessionId, completionMet, reason } = body as {
    sessionId: string;
    completionMet: boolean;
    reason?: "completed" | "stopped_early"; // explicit close reason
  };

  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Determine status from context
  let status: SessionStatus;
  if (completionMet) {
    status = "completed";
  } else if (reason === "stopped_early") {
    status = "stopped_early";
  } else if (session.status === "soft_locked") {
    status = "soft_locked";
  } else {
    status = "stopped_early";
  }

  // Write to Obsidian
  let obsidianPath: string | null = null;
  let exportError: string | null = null;
  try {
    // Update status before export so the log reflects final state
    updateSession(sessionId, { status, completionMet });
    const exportSession = getSession(sessionId)!;
    obsidianPath = await writeSessionToObsidian(exportSession);
  } catch (err) {
    exportError = err instanceof Error ? err.message : String(err);
    console.error("Failed to write to Obsidian:", exportError);
    // If export failed, mark it
    if (status === "completed" || status === "stopped_early") {
      status = "export_failed";
    }
  }

  const updated = updateSession(sessionId, { status, completionMet });

  return NextResponse.json({
    session: updated,
    obsidianPath,
    exportError,
  });
}
