/**
 * Workspace → Session adapter.
 * Projects workspace sequence into the Session schema for
 * pattern detection, Obsidian export, and usage meters.
 */

import type { Workspace } from "./workspace";
import {
  Session,
  Exchange,
  HeuristicFlags,
  SessionMode,
  ContextBlock,
} from "./types";
import { analyzeHeuristics } from "./heuristics";

export function workspaceToSession(ws: Workspace): Session {
  // Walk the sequence, pair human + AI fragments into exchanges
  const fragments = ws.sequence
    .map((id) => ws.fragments[id])
    .filter((f) => f && f.status === "complete" && f.provenance.type !== "system");

  const exchanges: Exchange[] = [];
  let i = 0;
  while (i < fragments.length) {
    const frag = fragments[i];
    const isHuman = frag.provenance.type === "human-typed" || frag.provenance.type === "split" || frag.provenance.type === "extracted";

    if (!isHuman) {
      // AI fragment without preceding human — treat as standalone
      i++;
      continue;
    }

    const nextFrag = i + 1 < fragments.length ? fragments[i + 1] : null;
    const isNextAI = nextFrag && nextFrag.provenance.type === "ai-generated";

    const heuristicFlags: HeuristicFlags = analyzeHeuristics(
      frag.content,
      { intent: ws.intent, budget: 999, exchanges }
    );

    const exchange: Exchange = {
      index: exchanges.length,
      timestamp: frag.createdAt,
      userMessage: frag.content,
      systemResponse: isNextAI ? nextFrag.content : "",
      heuristicFlags,
      classifierFlags: null,
      interventionShown: null,
      userResponseToIntervention: null,
    };

    exchanges.push(exchange);
    i += isNextAI ? 2 : 1;
  }

  const validModes: SessionMode[] = ["instrumental", "exploratory", "reflective"];
  const mode: SessionMode = validModes.includes(ws.mode as SessionMode)
    ? (ws.mode as SessionMode)
    : "exploratory";

  const contextBlocks: ContextBlock[] = [];

  return {
    id: ws.id,
    createdAt: ws.createdAt,
    intent: ws.intent,
    completionCondition: ws.completionCondition,
    mode,
    budget: 999,
    exchanges,
    status: "active",
    completionMet: null,
    contextBlocks,
    excludedExchanges: [],
    interventionLog: [],
  };
}
