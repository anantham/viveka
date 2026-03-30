import { NextRequest, NextResponse } from "next/server";
import { createTree } from "@/lib/tree";
import { saveTree } from "@/lib/tree-store";

/**
 * Create a freeform dump session.
 * Minimal structure — just a title and optional ambient context.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { title, ambient } = body as {
    title?: string;
    ambient?: {
      music?: string;
      location?: string;
      mood?: string;
      bodyState?: string;
    };
  };

  const tree = createTree(
    title || "Freeform dump",
    "Capture complete when the thought feels externalized",
    "reflective",
    { rerollCount: 3, draftCount: 3, model: "sonnet" }
  );

  // Store ambient metadata on the root node's content
  if (ambient) {
    const root = tree.nodes[tree.rootId];
    const parts: string[] = [];
    if (ambient.music) parts.push(`🎵 ${ambient.music}`);
    if (ambient.location) parts.push(`📍 ${ambient.location}`);
    if (ambient.mood) parts.push(`${ambient.mood}`);
    if (ambient.bodyState) parts.push(`🧘 ${ambient.bodyState}`);
    if (parts.length > 0) {
      root.content = parts.join(" · ");
    }
  }

  saveTree(tree);
  return NextResponse.json(tree);
}
