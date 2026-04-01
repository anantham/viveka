import { NextRequest, NextResponse } from "next/server";
import { getWorkspace } from "@/lib/workspace-store";
import { workspaceToSession } from "@/lib/workspace-session-adapter";
import { writeSessionToObsidian } from "@/lib/obsidian";

/**
 * POST { treeId } -> generates the virtual Session from the tree's
 * active path and writes it to the Obsidian vault using the existing
 * session export pipeline. Returns the vault file path on success.
 */
export async function POST(req: NextRequest) {
  const { treeId } = await req.json();

  if (!treeId) {
    return NextResponse.json(
      { error: "treeId is required" },
      { status: 400 }
    );
  }

  const ws = getWorkspace(treeId);
  if (!ws) {
    return NextResponse.json(
      { error: "Tree not found" },
      { status: 404 }
    );
  }

  const session = workspaceToSession(ws);

  try {
    const obsidianPath = await writeSessionToObsidian(session);
    return NextResponse.json({ obsidianPath });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Tree export to Obsidian failed:", message);
    return NextResponse.json(
      { error: `Export failed: ${message}` },
      { status: 500 }
    );
  }
}
