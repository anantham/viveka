import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { ConversationTree } from "./tree";

const DATA_DIR = join(process.cwd(), ".viveka-data");
const TREES_FILE = join(DATA_DIR, "trees.json");

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadAll(): Record<string, ConversationTree> {
  ensureDir();
  try {
    return JSON.parse(readFileSync(TREES_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveAll(trees: Record<string, ConversationTree>) {
  ensureDir();
  writeFileSync(TREES_FILE, JSON.stringify(trees, null, 2), "utf-8");
}

export function saveTree(tree: ConversationTree): void {
  const all = loadAll();
  all[tree.id] = tree;
  saveAll(all);
}

export function getTree(id: string): ConversationTree | undefined {
  return loadAll()[id];
}

export function listTrees(): ConversationTree[] {
  return Object.values(loadAll()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function deleteTree(id: string): boolean {
  const all = loadAll();
  if (!(id in all)) return false;
  delete all[id];
  saveAll(all);
  return true;
}
