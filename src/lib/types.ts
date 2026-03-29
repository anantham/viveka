export type SessionMode = "instrumental" | "exploratory" | "reflective";
export type SessionStatus =
  | "active"
  | "completed"        // user confirmed completion condition met
  | "stopped_early"    // user ended before completion condition met
  | "soft_locked"      // budget exhausted, increasingly delayed but not blocked
  | "export_failed";   // session ended but Obsidian export failed
export type InterventionType = "nudge" | "warning" | "pause" | "stop";
export type InterventionSource = "heuristic" | "classifier";
export type InterventionResponse = "accepted" | "dismissed" | "revised_intent" | null;

export interface ContextBlock {
  id: string;
  name: string;
  source: "paste" | "file" | "url" | "library";
  content: string;
  charCount: number;
  tokenEstimate: number;
  enabled: boolean;
  addedAt: string;
}

export interface Session {
  id: string;
  createdAt: string;
  intent: string;
  completionCondition: string;
  mode: SessionMode;
  budget: number;
  exchanges: Exchange[];
  status: SessionStatus;
  completionMet: boolean | null;
  contextBlocks: ContextBlock[];
  excludedExchanges: number[]; // indices of exchanges to exclude from context
  interventionLog: InterventionEvent[]; // first-class log of all interventions shown
}

export interface Exchange {
  index: number;
  timestamp: string;
  userMessage: string;
  systemResponse: string;
  heuristicFlags: HeuristicFlags;
  classifierFlags: ClassifierFlags | null;
  interventionShown: Intervention | null;
  userResponseToIntervention: InterventionResponse;
}

export interface HeuristicFlags {
  exchangeCount: number;
  budgetRemaining: number;
  anthropomorphicMarkers: string[];
  anthropomorphicLevel: 0 | 1 | 2 | 3 | 4;
  abstractionLevel: 0 | 1 | 2 | 3 | 4;
  abstractionEscalation: boolean;
  loopSimilarity: number;
  messageLengthAnomaly: boolean;
  modeShiftIndicator: boolean;
  tangentDistance: number;
}

export interface ClassifierFlags {
  abstractionLevel: number;
  loopDetected: boolean;
  anthropomorphicLevel: number;
  noveltyScore: number;
  mode: string;
  completionProximity: number;
  interventionRecommended: InterventionType | null;
  reason: string;
}

export interface Intervention {
  type: InterventionType;
  message: string;
  source: InterventionSource;
}

/** First-class logged event for cross-session analysis */
export interface InterventionEvent {
  id: string;
  sessionId: string;
  exchangeIndex: number;
  timestamp: string;
  intervention: Intervention;
  outcome: InterventionResponse;
  /** What the user did after seeing the intervention */
  followUpAction: "continued" | "revised_intent" | "ended_session" | "none";
  /** Exchange content at the time of intervention (for pattern mining) */
  triggerContext: {
    userMessage: string;
    heuristicFlags: HeuristicFlags;
    classifierFlags: ClassifierFlags | null;
  };
}

// Rough token estimate: ~4 chars per token for English text
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// 1M context window, leave room for system prompt + response
export const MAX_CONTEXT_TOKENS = 900_000;

export const MODE_DEFAULTS: Record<SessionMode, { budget: number; followUps: number; interventionProfile: string }> = {
  instrumental: { budget: 8, followUps: 2, interventionProfile: "tight" },
  exploratory: { budget: 12, followUps: 3, interventionProfile: "moderate" },
  reflective: { budget: 5, followUps: 1, interventionProfile: "aggressive" },
};
