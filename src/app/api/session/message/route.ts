import { NextRequest, NextResponse } from "next/server";
import { getSession, updateSession } from "@/lib/session-store";
import { queryClaudeCode } from "@/lib/claude";
import { buildSystemPrompt } from "@/lib/system-prompt";
import { analyzeHeuristics, shouldTriggerClassifier } from "@/lib/heuristics";
import { classifyExchange } from "@/lib/classifier";
import { computeDelay } from "@/lib/delay";
import {
  Exchange,
  Intervention,
  ClassifierFlags,
  HeuristicFlags,
} from "@/lib/types";

function buildIntervention(
  heuristics: HeuristicFlags,
  classifierFlags: ClassifierFlags | null
): Intervention | null {
  // Classifier interventions take priority
  if (classifierFlags?.interventionRecommended) {
    return {
      type: classifierFlags.interventionRecommended,
      message: classifierFlags.reason,
      source: "classifier",
    };
  }

  // Heuristic-based interventions
  if (heuristics.anthropomorphicLevel >= 4) {
    return {
      type: "pause",
      message:
        "Attachment language detected. This system is a tool, not a companion. Consider whether this interaction pattern serves your stated intent.",
      source: "heuristic",
    };
  }

  if (heuristics.anthropomorphicLevel >= 3) {
    return {
      type: "nudge",
      message: `Anthropomorphic framing detected: "${heuristics.anthropomorphicMarkers.join('", "')}". Reframing to specification syntax.`,
      source: "heuristic",
    };
  }

  if (heuristics.abstractionEscalation) {
    return {
      type: "warning",
      message:
        "Abstraction escalation: three consecutive increases in abstraction level. Return to stated intent or revise session purpose.",
      source: "heuristic",
    };
  }

  if (heuristics.loopSimilarity > 0.7) {
    return {
      type: "warning",
      message:
        "This query has high similarity to a previous exchange. Consider whether the prior response was insufficient or whether you are seeking something this system cannot provide.",
      source: "heuristic",
    };
  }

  if (heuristics.tangentDistance > 0.85) {
    return {
      type: "nudge",
      message:
        "Significant drift from declared intent detected. Return to session purpose or revise intent.",
      source: "heuristic",
    };
  }

  return null;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { sessionId, message } = body as {
    sessionId: string;
    message: string;
  };

  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (session.status !== "active") {
    return NextResponse.json(
      { error: `Session is ${session.status}` },
      { status: 400 }
    );
  }

  const totalStart = Date.now();
  const timing: Record<string, number> = {};

  // Run heuristics
  const hStart = Date.now();
  const heuristics = analyzeHeuristics(message, session);
  timing.heuristics_ms = Date.now() - hStart;

  // Compute delay
  const delay = computeDelay(session, heuristics);

  // Build conversation history for Claude (respecting excluded exchanges)
  const excluded = new Set(session.excludedExchanges || []);
  const conversationHistory = session.exchanges
    .filter((ex) => !excluded.has(ex.index))
    .flatMap((ex) => [
      { role: "user" as const, content: ex.userMessage },
      { role: "assistant" as const, content: ex.systemResponse },
    ]);

  // Build system prompt with session context
  const systemPrompt = buildSystemPrompt(session);

  // Query Claude (model configurable via env, default sonnet for speed)
  const model = process.env.VIVEKA_MODEL || "sonnet";
  const claudeStart = Date.now();
  console.log(`[viveka] Exchange ${session.exchanges.length + 1}/${session.budget} — calling claude -p (${model})...`);
  let response;
  try {
    response = await queryClaudeCode(
      message,
      systemPrompt,
      conversationHistory,
      { model, noTools: true }
    );
    timing.claude_ms = Date.now() - claudeStart;
    console.log(`[viveka] Claude: ${timing.claude_ms}ms (${response.text.length} chars)`);
  } catch (err) {
    timing.claude_ms = Date.now() - claudeStart;
    console.error(`[viveka] Claude failed after ${timing.claude_ms}ms:`, err);
    return NextResponse.json(
      { error: `Claude call failed after ${timing.claude_ms}ms: ${err instanceof Error ? err.message : String(err)}`, timing },
      { status: 502 }
    );
  }

  // Build heuristic-only intervention (classifier runs in background)
  const intervention = buildIntervention(heuristics, null);

  // Create exchange record (classifier will be patched in async)
  const exchange: Exchange = {
    index: session.exchanges.length,
    timestamp: new Date().toISOString(),
    userMessage: message,
    systemResponse: response.text,
    heuristicFlags: heuristics,
    classifierFlags: null,
    interventionShown: intervention,
    userResponseToIntervention: null,
  };

  // Update session
  const storeStart = Date.now();
  const updatedExchanges = [...session.exchanges, exchange];
  const newStatus =
    updatedExchanges.length >= session.budget ? "budget_exhausted" : "active";

  updateSession(sessionId, {
    exchanges: updatedExchanges,
    status: newStatus === "budget_exhausted" ? "budget_exhausted" : session.status,
  });
  timing.store_ms = Date.now() - storeStart;
  timing.total_ms = Date.now() - totalStart;

  console.log(`[viveka] Done: ${timing.total_ms}ms total (claude ${timing.claude_ms}ms, heuristics ${timing.heuristics_ms}ms)`);

  // Fire-and-forget: run classifier in background and patch the exchange
  if (shouldTriggerClassifier(heuristics)) {
    const exchangeIndex = exchange.index;
    console.log(`[viveka] Background classifier started for exchange ${exchangeIndex}...`);
    classifyExchange(
      message,
      response.text,
      session.intent,
      session.exchanges.slice(-3)
    ).then((classifierFlags) => {
      console.log(`[viveka] Background classifier done for exchange ${exchangeIndex}`);
      // Patch the exchange in the session store
      const current = getSession(sessionId);
      if (current && current.exchanges[exchangeIndex]) {
        current.exchanges[exchangeIndex].classifierFlags = classifierFlags;
        // Also check if classifier recommends an intervention stronger than heuristic one
        const classifierIntervention = buildIntervention(
          current.exchanges[exchangeIndex].heuristicFlags,
          classifierFlags
        );
        if (classifierIntervention) {
          current.exchanges[exchangeIndex].interventionShown = classifierIntervention;
        }
        updateSession(sessionId, { exchanges: current.exchanges });
      }
    }).catch((err) => {
      console.error(`[viveka] Background classifier failed:`, err);
    });
  }

  // Compute context token usage
  const contextTokens = (session.contextBlocks || [])
    .filter((b) => b.enabled)
    .reduce((sum, b) => sum + b.tokenEstimate, 0);
  const historyTokens = Math.ceil(
    conversationHistory.reduce((sum, m) => sum + m.content.length, 0) / 4
  );

  return NextResponse.json({
    exchange,
    delay,
    timing,
    sessionStatus: newStatus,
    budgetUsed: updatedExchanges.length,
    budgetTotal: session.budget,
    rateLimit: response.rateLimit,
    usage: response.usage,
    contextUsage: {
      contextBlockTokens: contextTokens,
      historyTokens,
      totalTokens: contextTokens + historyTokens,
      maxTokens: 1_000_000,
    },
  });
}
