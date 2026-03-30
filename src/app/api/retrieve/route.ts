import { NextRequest, NextResponse } from "next/server";
import { searchVault } from "@/lib/vault-search";
import { readFileSync } from "fs";

const getVaultPath = () => process.env.OBSIDIAN_VAULT_PATH || "";

/**
 * POST { text } → search the Obsidian vault for notes matching terms in the text.
 * Returns matches with title, path, excerpts, and matched term.
 *
 * POST { path } → load a specific note's full content (for adding to context).
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const vaultPath = getVaultPath();

  if (!vaultPath) {
    return NextResponse.json(
      { error: "OBSIDIAN_VAULT_PATH not configured" },
      { status: 500 }
    );
  }

  // Mode 1: Search vault for matching terms
  if (body.text) {
    const matches = searchVault(vaultPath, body.text, body.maxResults || 15);
    return NextResponse.json({ matches });
  }

  // Mode 2: Load a specific note's content
  if (body.path) {
    try {
      const content = readFileSync(body.path, "utf-8");
      return NextResponse.json({
        content,
        charCount: content.length,
        tokenEstimate: Math.ceil(content.length / 4),
      });
    } catch (err) {
      return NextResponse.json(
        { error: `Failed to read note: ${err}` },
        { status: 400 }
      );
    }
  }

  return NextResponse.json({ error: "Provide 'text' or 'path'" }, { status: 400 });
}
