import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { Session, Exchange, HeuristicFlags } from "@/lib/types";
import { analyzeHeuristics, shouldTriggerClassifier } from "@/lib/heuristics";
import { v4 as uuidv4 } from "uuid";
import { join } from "path";
import { readFileSync as readFS, writeFileSync, mkdirSync, existsSync } from "fs";

const DATA_DIR = join(process.cwd(), ".viveka-data");
const SESSIONS_FILE = join(DATA_DIR, "sessions.json");

function loadSessions(): Session[] {
  try {
    return JSON.parse(readFS(SESSIONS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function saveSessions(sessions: Session[]) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), "utf-8");
}

interface ClaudeMessage {
  uuid: string;
  text: string;
  sender: "human" | "assistant";
  created_at: string;
  content?: Array<{ type: string; text?: string }>;
}

interface ClaudeConversation {
  uuid: string;
  name: string;
  summary: string;
  created_at: string;
  updated_at: string;
  chat_messages: ClaudeMessage[];
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { path, limit, filter } = body as {
    path: string; // path to conversations.json or the backup dir
    limit?: number;
    filter?: string; // optional name filter
  };

  let filePath = path;
  if (!filePath.endsWith(".json")) {
    filePath = join(filePath, "conversations.json");
  }

  let conversations: ClaudeConversation[];
  try {
    conversations = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to read ${filePath}: ${err}` },
      { status: 400 }
    );
  }

  // Sort by most recent first
  conversations.sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );

  // Apply filter
  if (filter) {
    const f = filter.toLowerCase();
    conversations = conversations.filter(
      (c) =>
        c.name?.toLowerCase().includes(f) ||
        c.summary?.toLowerCase().includes(f)
    );
  }

  // Apply limit
  const maxImport = limit || 50;
  conversations = conversations.slice(0, maxImport);

  // Skip conversations with no messages
  conversations = conversations.filter((c) => c.chat_messages?.length >= 2);

  const existingSessions = loadSessions();
  const existingUuids = new Set(existingSessions.map((s) => s.id));
  const imported: Array<{ id: string; name: string; exchanges: number }> = [];

  for (const conv of conversations) {
    // Use the original UUID to avoid double-importing
    if (existingUuids.has(conv.uuid)) continue;

    // Pair human/assistant messages into exchanges
    const exchanges: Exchange[] = [];
    const msgs = conv.chat_messages;

    for (let i = 0; i < msgs.length - 1; i++) {
      if (msgs[i].sender === "human" && msgs[i + 1]?.sender === "assistant") {
        const userText = msgs[i].text || "";
        const sysText = msgs[i + 1].text || "";

        if (!userText.trim() || !sysText.trim()) continue;

        // Run heuristics retroactively
        const stubSession = {
          intent: conv.name || "imported conversation",
          budget: 999,
          exchanges,
        };
        const heuristics = analyzeHeuristics(userText, stubSession);

        const exchange: Exchange = {
          index: exchanges.length,
          timestamp: msgs[i].created_at,
          userMessage: userText,
          systemResponse: sysText,
          heuristicFlags: heuristics,
          classifierFlags: null,
          interventionShown: null,
          userResponseToIntervention: null,
        };

        exchanges.push(exchange);
        i++; // skip the assistant message
      }
    }

    if (exchanges.length === 0) continue;

    const session: Session = {
      id: conv.uuid,
      createdAt: conv.created_at,
      intent: conv.name || "Imported conversation",
      completionCondition: "Imported — no condition set",
      mode: "exploratory",
      budget: exchanges.length,
      exchanges,
      status: "completed",
      completionMet: null,
      contextBlocks: [],
      excludedExchanges: [],
    };

    existingSessions.push(session);
    imported.push({
      id: session.id,
      name: session.intent,
      exchanges: exchanges.length,
    });
  }

  saveSessions(existingSessions);

  return NextResponse.json({
    imported: imported.length,
    skipped: conversations.length - imported.length,
    sessions: imported,
  });
}
