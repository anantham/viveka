import { Session, HeuristicFlags } from "./types";

export interface DelayResult {
  delayMs: number;
  message: string | null;
  requiresConfirmation: boolean;
}

export function computeDelay(
  session: Session,
  heuristics: HeuristicFlags
): DelayResult {
  const used = session.exchanges.length;
  const budget = session.budget;
  const ratio = used / budget;

  // Post-budget: cumulative 10s per extra exchange
  if (used >= budget) {
    const overage = used - budget + 1;
    return {
      delayMs: 10_000 * overage,
      message: `Session budget exhausted. Exchange ${used + 1} beyond budget. ${overage * 10}s delay applied.`,
      requiresConfirmation: true,
    };
  }

  // Abstraction escalation detected: 10s delay
  if (heuristics.abstractionEscalation) {
    return {
      delayMs: 10_000,
      message:
        "Abstraction escalation detected. While waiting, notice what is happening in the body.",
      requiresConfirmation: false,
    };
  }

  // Loop detected: 30s delay
  if (heuristics.loopSimilarity > 0.7) {
    return {
      delayMs: 30_000,
      message:
        "This query has high similarity to a previous exchange. Consider cancelling.",
      requiresConfirmation: false,
    };
  }

  // 75% budget consumed: 2s delay
  if (ratio >= 0.75) {
    return {
      delayMs: 2_000,
      message: null,
      requiresConfirmation: false,
    };
  }

  // No delay
  return { delayMs: 0, message: null, requiresConfirmation: false };
}
