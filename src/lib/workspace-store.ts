/**
 * Workspace persistence. Reads/writes to .viveka-data/workspaces.json.
 * Auto-migrates old ConversationTree data on read.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import type { Workspace } from "./workspace";
import { ensureWorkspace } from "./workspace-migrate";

const DATA_DIR = join(process.cwd(), ".viveka-data");
const WORKSPACES_FILE = join(DATA_DIR, "workspaces.json");
const LEGACY_TREES_FILE = join(DATA_DIR, "trees.json");

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadAll(): Record<string, Workspace> {
  ensureDir();

  // Try new format first
  try {
    const data = JSON.parse(readFileSync(WORKSPACES_FILE, "utf-8"));
    const result: Record<string, Workspace> = {};
    for (const [id, raw] of Object.entries(data)) {
      result[id] = ensureWorkspace(raw);
    }
    return result;
  } catch {
    // No workspaces file — try migrating from legacy trees
  }

  try {
    const data = JSON.parse(readFileSync(LEGACY_TREES_FILE, "utf-8"));
    const result: Record<string, Workspace> = {};
    for (const [id, raw] of Object.entries(data)) {
      result[id] = ensureWorkspace(raw);
    }
    // Save migrated data to new file
    saveAll(result);
    console.log(`[workspace-store] migrated ${Object.keys(result).length} trees → workspaces`);
    return result;
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
