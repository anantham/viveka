import { ConversationTree, getActivePath } from "./tree";
import {
  Session,
  Exchange,
  HeuristicFlags,
  SessionMode,
  ContextBlock,
} from "./types";
import { analyzeHeuristics } from "./heuristics";

/**
 * Generate a virtual Session from a ConversationTree's active path.
 * This allows all session-based features (pattern detection, budget,
 * context blocks, interventions, Obsidian export, usage meters) to
 * work on tree data without duplicating logic.
 *
 * The session ID matches the tree ID so they remain linked.
 */
export function treeToSession(tree: ConversationTree): Session {
  const activePath = getActivePath(tree);

  // Filter out system nodes — only user and assistant nodes become exchanges
  const contentNodes = activePath.filter(
    (n) => (n.role === "user" || n.role === "assistant") && n.status === "complete"
  );

  // Pair consecutive user+assistant nodes into Exchange objects
  const exchanges: Exchange[] = [];
  let i = 0;
  while (i < contentNodes.length) {
    const userNode = contentNodes[i];
    if (userNode.role !== "user") {
      // Skip unpaired assistant nodes at the start
      i++;
      continue;
    }

    const assistantNode =
      i + 1 < contentNodes.length && contentNodes[i + 1].role === "assistant"
        ? contentNodes[i + 1]
        : null;

    // Build the partial session context for heuristic analysis:
    // all exchanges so far (before this one)
    const sessionContext = {
      intent: tree.intent,
      budget: 999,
      exchanges,
    };

    const heuristicFlags: HeuristicFlags = analyzeHeuristics(
      userNode.content,
      sessionContext
    );

    const exchange: Exchange = {
      index: exchanges.length,
      timestamp: userNode.createdAt,
      userMessage: userNode.content,
      systemResponse: assistantNode?.content ?? "",
      heuristicFlags,
      classifierFlags: null,
      interventionShown: null,
      userResponseToIntervention: null,
    };

    exchanges.push(exchange);
    // Advance past the pair (or just the user node if no assistant followed)
    i += assistantNode ? 2 : 1;
  }

  // Map tree.mode to SessionMode, defaulting to "exploratory" if unrecognized
  const validModes: SessionMode[] = ["instrumental", "exploratory", "reflective"];
  const mode: SessionMode = validModes.includes(tree.mode as SessionMode)
    ? (tree.mode as SessionMode)
    : "exploratory";

  // Resolve context blocks from tree.contextBlockIds
  // Trees store IDs only — we create empty placeholder blocks.
  // In practice the ContextPanel fetches real blocks from the library API.
  const contextBlocks: ContextBlock[] = [];

  const session: Session = {
    id: tree.id,
    createdAt: tree.createdAt,
    intent: tree.intent,
    completionCondition: tree.completionCondition,
    mode,
    budget: 999, // trees don't enforce a turn budget
    exchanges,
    status: "active",
    completionMet: null,
    contextBlocks,
    excludedExchanges: [],
    interventionLog: [],
  };

  return session;
}
