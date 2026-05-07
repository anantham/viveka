/**
 * Workspace persistence. Reads/writes to .viveka-data/workspaces.json.
 * The legacy ConversationTree migration path was retired together
 * with src/lib/tree.ts — the canvas has been on the Workspace data
 * model for long enough that any active workspace has already
 * migrated. Anyone with an unmigrated trees.json from before the
 * cutover should rerun an older build to convert before pulling.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import type { Workspace } from "./workspace";

const DATA_DIR = join(process.cwd(), ".viveka-data");
const WORKSPACES_FILE = join(DATA_DIR, "workspaces.json");

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadAll(): Record<string, Workspace> {
  ensureDir();
  try {
    const data = JSON.parse(readFileSync(WORKSPACES_FILE, "utf-8"));
    return data as Record<string, Workspace>;
  } catch {
    return {};
  }
}

function saveAll(workspaces: Record<string, Workspace>) {
  ensureDir();
  writeFileSync(WORKSPACES_FILE, JSON.stringify(workspaces, null, 2), "utf-8");
}

export function saveWorkspace(ws: Workspace): void {
  const all = loadAll();
  all[ws.id] = ws;
  saveAll(all);
}

export function getWorkspace(id: string): Workspace | undefined {
  return loadAll()[id];
}

export function listWorkspaces(): Workspace[] {
  return Object.values(loadAll()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function deleteWorkspace(id: string): boolean {
  const all = loadAll();
  if (!(id in all)) return false;
  delete all[id];
  saveAll(all);
  return true;
}
