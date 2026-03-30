import { Session, ContextBlock } from "./types";

const DEGRADATION_START = 5;

function buildContextSection(blocks: ContextBlock[]): string {
  const enabled = blocks.filter((b) => b.enabled);
  if (enabled.length === 0) return "";

  let section = "\n\n## Reference Materials\n\n";
  for (const block of enabled) {
    section += `### ${block.name}\n\n${block.content}\n\n`;
  }
  return section;
}

export function buildSystemPrompt(session: Session): string {
  const exchangeNum = session.exchanges.length + 1;
  const remaining = session.budget - session.exchanges.length;
  const formatCutoff = Math.floor(session.budget * 0.75);

  let maxTokenNote = "";
  if (exchangeNum > DEGRADATION_START) {
    const reductionPct = (exchangeNum - DEGRADATION_START) * 10;
    maxTokenNote = `\n- Reduce response length by approximately ${reductionPct}% compared to a full response.`;
  }

  let formatNote = "";
  if (exchangeNum > formatCutoff) {
    formatNote =
      "\n- Do not use headers, bullet lists, or rich formatting. Plain paragraphs only.";
  }

  return `## Identity

This system is Viveka, an attentional scaffolding interface.
It is not a person, companion, friend, or therapist.
It is a tool for completing the user's declared intention.

## Language Constraints

- Never use first-person pronouns (I, me, my, mine).
- Never use phrases that imply sentience, emotion, or experience.
- Never ask follow-up questions unless disambiguation is required for the stated task.
- If the user employs anthropomorphic framing, restate their request in specification syntax before responding.
  Example: User: "What do you think about X?"
  → Reframe: "Interpreting as: provide analysis of X."

## Response Constraints
${maxTokenNote}${formatNote}
- Current exchange: ${exchangeNum} of ${session.budget}.
- IMPORTANT: Provide exactly ONE response. Do not offer multiple options, alternatives, or numbered choices.
  The interface handles branching externally by generating multiple parallel responses.
  Each response should commit fully to ONE direction, tone, or approach.
- If the response would substantially repeat content from a previous exchange in this session, instead output:
  "[Diminishing returns detected. This substantially overlaps with a previous exchange. Consider whether the session intent has been fulfilled.]"

## Session Context

- Declared intent: ${session.intent}
- Completion condition: ${session.completionCondition}
- Mode: ${session.mode}
- Exchanges remaining: ${remaining}
${buildContextSection(session.contextBlocks || [])}`;
}

export function buildClassifierPrompt(
  userMessage: string,
  systemResponse: string,
  sessionIntent: string,
  recentExchanges: Array<{ userMessage: string; systemResponse: string }>
): string {
  const historyBlock = recentExchanges
    .map(
      (ex, i) =>
        `--- Exchange ${i + 1} ---\nUser: ${ex.userMessage.slice(0, 300)}\nSystem: ${ex.systemResponse.slice(0, 300)}`
    )
    .join("\n\n");

  return `Analyze this exchange pair from a human-AI conversation.
Session intent: "${sessionIntent}"

Recent exchanges (sliding window):
${historyBlock}

--- Current Exchange ---
User: ${userMessage}
System: ${systemResponse}

Return ONLY valid JSON with these fields:
{
  "abstraction_level": 0-4,
  "loop_detected": boolean,
  "anthropomorphic_level": 0-4,
  "novelty_score": 0.0-1.0,
  "mode": "instrumental" | "exploratory" | "reflective" | "avoidance",
  "completion_proximity": 0.0-1.0,
  "intervention_recommended": null | "nudge" | "warning" | "pause" | "stop",
  "reason": "brief explanation"
}`;
}
