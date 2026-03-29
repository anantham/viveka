import { Session, SessionMode, MODE_DEFAULTS } from "./types";
import { v4 as uuidv4 } from "uuid";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

// Persist sessions to a local JSON file so they survive hot reloads
const DATA_DIR = join(process.cwd(), ".viveka-data");
const SESSIONS_FILE = join(DATA_DIR, "sessions.json");

function ensureDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadSessions(): Map<string, Session> {
  ensureDir();
  try {
    const data = readFileSync(SESSIONS_FILE, "utf-8");
    const arr: Session[] = JSON.parse(data);
    return new Map(arr.map((s) => [s.id, s]));
  } catch {
    return new Map();
  }
}

function saveSessions(sessions: Map<string, Session>) {
  ensureDir();
  writeFileSync(
    SESSIONS_FILE,
    JSON.stringify(Array.from(sessions.values()), null, 2),
    "utf-8"
  );
}

export function createSession(
  intent: string,
  completionCondition: string,
  mode: SessionMode,
  budgetOverride?: number
): Session {
  const sessions = loadSessions();
  const defaults = MODE_DEFAULTS[mode];
  const session: Session = {
    id: uuidv4(),
    createdAt: new Date().toISOString(),
    intent,
    completionCondition,
    mode,
    budget: budgetOverride ?? defaults.budget,
    exchanges: [],
    status: "active",
    completionMet: null,
    contextBlocks: [],
    excludedExchanges: [],
  };
  sessions.set(session.id, session);
  saveSessions(sessions);
  return session;
}

export function getSession(id: string): Session | undefined {
  const sessions = loadSessions();
  return sessions.get(id);
}

export function updateSession(id: string, updates: Partial<Session>): Session | undefined {
  const sessions = loadSessions();
  const session = sessions.get(id);
  if (!session) return undefined;
  const updated = { ...session, ...updates };
  sessions.set(id, updated);
  saveSessions(sessions);
  return updated;
}

export function listSessions(): Session[] {
  const sessions = loadSessions();
  return Array.from(sessions.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}
