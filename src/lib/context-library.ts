import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { ContextBlock, estimateTokens } from "./types";
import { v4 as uuidv4 } from "uuid";

const DATA_DIR = join(process.cwd(), ".viveka-data");
const LIBRARY_FILE = join(DATA_DIR, "context-library.json");

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

export function loadLibrary(): ContextBlock[] {
  ensureDir();
  try {
    return JSON.parse(readFileSync(LIBRARY_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function saveLibrary(blocks: ContextBlock[]) {
  ensureDir();
  writeFileSync(LIBRARY_FILE, JSON.stringify(blocks, null, 2), "utf-8");
}

export function addToLibrary(
  name: string,
  content: string,
  source: ContextBlock["source"]
): ContextBlock {
  const blocks = loadLibrary();
  const block: ContextBlock = {
    id: uuidv4(),
    name,
    source,
    content,
    charCount: content.length,
    tokenEstimate: estimateTokens(content),
    enabled: true,
    addedAt: new Date().toISOString(),
  };
  blocks.push(block);
  saveLibrary(blocks);
  return block;
}

export function removeFromLibrary(id: string): boolean {
  const blocks = loadLibrary();
  const filtered = blocks.filter((b) => b.id !== id);
  if (filtered.length === blocks.length) return false;
  saveLibrary(filtered);
  return true;
}

export function updateLibraryBlock(
  id: string,
  updates: Partial<Pick<ContextBlock, "name" | "content" | "enabled">>
): ContextBlock | null {
  const blocks = loadLibrary();
  const idx = blocks.findIndex((b) => b.id === id);
  if (idx === -1) return null;
  if (updates.content !== undefined) {
    const content = updates.content;
    blocks[idx].content = content;
    blocks[idx].charCount = content.length;
    blocks[idx].tokenEstimate = estimateTokens(content);
  }
  if (updates.name !== undefined) blocks[idx].name = updates.name;
  if (updates.enabled !== undefined) blocks[idx].enabled = updates.enabled;
  saveLibrary(blocks);
  return blocks[idx];
}

/** Load content from a local file path */
export function loadFileContent(filePath: string): string {
  return readFileSync(filePath, "utf-8");
}
