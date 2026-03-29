import { NextResponse } from "next/server";
import { listSessions } from "@/lib/session-store";

export async function GET() {
  const sessions = listSessions();
  return NextResponse.json(sessions);
}
