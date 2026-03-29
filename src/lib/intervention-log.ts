import { v4 as uuidv4 } from "uuid";
import {
  InterventionEvent,
  Intervention,
  InterventionResponse,
  HeuristicFlags,
  ClassifierFlags,
} from "./types";
import { getSession, updateSession } from "./session-store";

export function logIntervention(
  sessionId: string,
  exchangeIndex: number,
  intervention: Intervention,
  userMessage: string,
  heuristicFlags: HeuristicFlags,
  classifierFlags: ClassifierFlags | null
): InterventionEvent {
  const event: InterventionEvent = {
    id: uuidv4(),
    sessionId,
    exchangeIndex,
    timestamp: new Date().toISOString(),
    intervention,
    outcome: null,
    followUpAction: "none",
    triggerContext: {
      userMessage,
      heuristicFlags,
      classifierFlags,
    },
  };

  const session = getSession(sessionId);
  if (session) {
    const log = session.interventionLog || [];
    log.push(event);
    updateSession(sessionId, { interventionLog: log });
  }

  return event;
}

export function recordInterventionOutcome(
  sessionId: string,
  interventionId: string,
  outcome: InterventionResponse,
  followUpAction: InterventionEvent["followUpAction"]
): void {
  const session = getSession(sessionId);
  if (!session) return;

  const log = session.interventionLog || [];
  const event = log.find((e) => e.id === interventionId);
  if (event) {
    event.outcome = outcome;
    event.followUpAction = followUpAction;
    updateSession(sessionId, { interventionLog: log });
  }
}

/** Cross-session analysis: aggregate intervention patterns */
export interface InterventionAnalytics {
  totalInterventions: number;
  byType: Record<string, number>;
  byOutcome: Record<string, number>;
  dismissRate: number; // % of interventions dismissed
  revisionRate: number; // % that led to intent revision
  endRate: number; // % that led to session end
  mostIgnoredType: string | null;
}

export function analyzeInterventions(
  events: InterventionEvent[]
): InterventionAnalytics {
  const total = events.length;
  if (total === 0) {
    return {
      totalInterventions: 0,
      byType: {},
      byOutcome: {},
      dismissRate: 0,
      revisionRate: 0,
      endRate: 0,
      mostIgnoredType: null,
    };
  }

  const byType: Record<string, number> = {};
  const byOutcome: Record<string, number> = {};
  const dismissedByType: Record<string, number> = {};

  for (const e of events) {
    byType[e.intervention.type] = (byType[e.intervention.type] || 0) + 1;
    const outcome = e.outcome || "no_response";
    byOutcome[outcome] = (byOutcome[outcome] || 0) + 1;
    if (e.outcome === "dismissed") {
      dismissedByType[e.intervention.type] =
        (dismissedByType[e.intervention.type] || 0) + 1;
    }
  }

  const dismissed = byOutcome["dismissed"] || 0;
  const revised = events.filter((e) => e.followUpAction === "revised_intent").length;
  const ended = events.filter((e) => e.followUpAction === "ended_session").length;

  // Most ignored = highest dismiss rate by type
  let mostIgnoredType: string | null = null;
  let highestDismissRate = 0;
  for (const [type, count] of Object.entries(dismissedByType)) {
    const rate = count / (byType[type] || 1);
    if (rate > highestDismissRate) {
      highestDismissRate = rate;
      mostIgnoredType = type;
    }
  }

  return {
    totalInterventions: total,
    byType,
    byOutcome,
    dismissRate: dismissed / total,
    revisionRate: revised / total,
    endRate: ended / total,
    mostIgnoredType,
  };
}
