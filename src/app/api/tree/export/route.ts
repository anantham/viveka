import { NextRequest, NextResponse } from "next/server";
import { getWorkspace } from "@/lib/workspace-store";
import { workspaceToSession } from "@/lib/workspace-session-adapter";
import {
  writeSessionToObsidian,
  writeWorkspaceCanvasToObsidian,
  writeWorkspaceProseToObsidian,
} from "@/lib/obsidian";

type ExportFormat = "session" | "prose" | "canvas";

/**
 * POST { treeId, format? } — write workspace to the Obsidian vault.
 *
 *   format: "session" (default) — session-style markdown with
 *           frontmatter, exchange log, pattern metrics. Goes to
 *           {vault}/viveka/sessions/.
 *   format: "prose"            — plain prose joining the active
 *           sequence with minimal frontmatter. For reading.
 *           Goes to {vault}/viveka/prose/.
 *   format: "canvas"           — Obsidian .canvas file (JSON
 *           Canvas) so the workspace opens with its spatial
 *           layout intact in Obsidian's canvas viewer.
 *           Goes to {vault}/viveka/canvases/.
 *
 * Returns: { obsidianPath } on success.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { treeId?: string; format?: ExportFormat };
  const { treeId } = body;
  const format: ExportFormat = body.format ?? "session";

  if (!treeId) {
    return NextResponse.json({ error: "treeId is required" }, { status: 400 });
  }

  const ws = getWorkspace(treeId);
  if (!ws) {
    return NextResponse.json({ error: "Tree not found" }, { status: 404 });
  }

  try {
    let obsidianPath: string;
    if (format === "canvas") {
      obsidianPath = await writeWorkspaceCanvasToObsidian(ws);
    } else if (format === "prose") {
      obsidianPath = await writeWorkspaceProseToObsidian(ws);
    } else {
      const session = workspaceToSession(ws);
      obsidianPath = await writeSessionToObsidian(session);
    }
    return NextResponse.json({ obsidianPath, format });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[export:${format}] failed:`, message);
    return NextResponse.json(
      { error: `Export failed: ${message}` },
      { status: 500 },
    );
  }
}
