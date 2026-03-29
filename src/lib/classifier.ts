import { queryClaudeCode } from "./claude";
import { buildClassifierPrompt } from "./system-prompt";
import { ClassifierFlags, Exchange } from "./types";

/**
 * Runs the LLM classifier on an exchange pair.
 * Uses a sliding window of the last 3 exchanges for context.
 * Calls claude -p with --no-tools for a lightweight stateless classification.
 */
export async function classifyExchange(
  userMessage: string,
  systemResponse: string,
  sessionIntent: string,
  recentExchanges: Exchange[]
): Promise<ClassifierFlags> {
  const window = recentExchanges.slice(-3);
  const prompt = buildClassifierPrompt(
    userMessage,
    systemResponse,
    sessionIntent,
    window.map((e) => ({
      userMessage: e.userMessage,
      systemResponse: e.systemResponse,
    }))
  );

  const classifierSystemPrompt =
    "You are a pattern classifier for human-AI interactions. Return ONLY valid JSON, no markdown, no explanation.";

  try {
    const result = await queryClaudeCode(prompt, classifierSystemPrompt, [], {
      model: "haiku",
      noTools: true,
    });

    // Extract JSON from the response (handle markdown code blocks)
    let jsonStr = result.text;
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    const parsed = JSON.parse(jsonStr);

    return {
      abstractionLevel: parsed.abstraction_level ?? 0,
      loopDetected: parsed.loop_detected ?? false,
      anthropomorphicLevel: parsed.anthropomorphic_level ?? 0,
      noveltyScore: parsed.novelty_score ?? 1.0,
      mode: parsed.mode ?? "instrumental",
      completionProximity: parsed.completion_proximity ?? 0,
      interventionRecommended: parsed.intervention_recommended ?? null,
      reason: parsed.reason ?? "",
    };
  } catch (err) {
    console.error("Classifier failed, returning defaults:", err);
    return {
      abstractionLevel: 0,
      loopDetected: false,
      anthropomorphicLevel: 0,
      noveltyScore: 1.0,
      mode: "instrumental",
      completionProximity: 0,
      interventionRecommended: null,
      reason: "Classifier error",
    };
  }
}
