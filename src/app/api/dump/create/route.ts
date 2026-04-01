import { NextRequest, NextResponse } from "next/server";
import { createWorkspace } from "@/lib/workspace";
import { saveWorkspace } from "@/lib/workspace-store";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { title, ambient } = body as {
    title?: string;
    ambient?: { music?: string; location?: string; mood?: string; bodyState?: string };
  };

  const ws = createWorkspace(
    title || "Freeform dump",
    "Capture complete when the thought feels externalized",
    "reflective",
    { rerollCount: 3, draftCount: 3, model: "sonnet" }
  );

  if (ambient) {
    const rootId = ws.sequence[0];
    const root = ws.fragments[rootId];
    if (root) {
      const parts: string[] = [];
      if (ambient.music) parts.push(`🎵 ${ambient.music}`);
      if (ambient.location) parts.push(`📍 ${ambient.location}`);
      if (ambient.mood) parts.push(`${ambient.mood}`);
      if (ambient.bodyState) parts.push(`🧘 ${ambient.bodyState}`);
      if (parts.length > 0) root.content = parts.join(" · ");
    }
  }

  saveWorkspace(ws);
  return NextResponse.json(ws);
}
