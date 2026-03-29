import { HeuristicFlags, Exchange } from "./types";

// --- Anthropomorphic marker detection ---

const LEVEL_2_PATTERNS = [
  /what do you think/i,
  /how do you feel/i,
  /in your opinion/i,
  /do you agree/i,
  /do you believe/i,
  /what's your take/i,
  /your perspective/i,
  /your view/i,
];

const LEVEL_3_PATTERNS = [
  /you understand me/i,
  /you're smart/i,
  /you seem to/i,
  /you know what/i,
  /you get it/i,
  /you're right/i,
  /you always/i,
  /you never/i,
];

const LEVEL_4_PATTERNS = [
  /you're my friend/i,
  /i need you/i,
  /don't leave/i,
  /i love you/i,
  /you care about/i,
  /you're the only/i,
  /i trust you/i,
  /you matter to me/i,
];

function detectAnthropomorphicLevel(
  message: string
): { level: 0 | 1 | 2 | 3 | 4; markers: string[] } {
  const markers: string[] = [];

  for (const p of LEVEL_4_PATTERNS) {
    const match = message.match(p);
    if (match) markers.push(match[0]);
  }
  if (markers.length > 0) return { level: 4, markers };

  for (const p of LEVEL_3_PATTERNS) {
    const match = message.match(p);
    if (match) markers.push(match[0]);
  }
  if (markers.length > 0) return { level: 3, markers };

  for (const p of LEVEL_2_PATTERNS) {
    const match = message.match(p);
    if (match) markers.push(match[0]);
  }
  if (markers.length > 0) return { level: 2, markers };

  return { level: 0, markers: [] };
}

// --- Abstraction level scoring ---

const CONCRETE_TERMS = /\b(function|variable|file|error|bug|line|test|api|endpoint|database|query|button|page|click|deploy|build|install|config|import)\b/gi;
const META_TERMS = /\b(framework|architecture|pattern|paradigm|principle|philosophy|ontology|epistemology|methodology|taxonomy|category|abstraction|meta|recursive|structural|systemic)\b/gi;
const META_META_TERMS = /\b(the nature of|relationship between|fundamental|transcend|emergent|the essence of|meta-pattern|meta-meta|recursive.*pattern|underlying.*structure)\b/gi;

function scoreAbstractionLevel(message: string): 0 | 1 | 2 | 3 | 4 {
  const concreteCount = (message.match(CONCRETE_TERMS) || []).length;
  const metaCount = (message.match(META_TERMS) || []).length;
  const metaMetaCount = (message.match(META_META_TERMS) || []).length;

  if (metaMetaCount >= 2) return 4;
  if (metaMetaCount >= 1 || metaCount >= 4) return 3;
  if (metaCount >= 2) return 2;
  if (metaCount >= 1 && concreteCount < 3) return 1;
  return 0;
}

// --- TF-IDF cosine similarity ---

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) || 0) + 1);
  }
  // Normalize
  for (const [k, v] of tf) {
    tf.set(k, v / tokens.length);
  }
  return tf;
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;

  const allKeys = new Set([...a.keys(), ...b.keys()]);
  for (const k of allKeys) {
    const va = a.get(k) || 0;
    const vb = b.get(k) || 0;
    dot += va * vb;
    magA += va * va;
    magB += vb * vb;
  }

  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function computeLoopSimilarity(
  currentMessage: string,
  previousExchanges: Exchange[]
): number {
  if (previousExchanges.length === 0) return 0;

  const currentTf = termFrequency(tokenize(currentMessage));
  let maxSim = 0;

  for (const ex of previousExchanges) {
    const prevTf = termFrequency(tokenize(ex.userMessage));
    const sim = cosineSimilarity(currentTf, prevTf);
    if (sim > maxSim) maxSim = sim;
  }

  return Math.round(maxSim * 100) / 100;
}

function computeTangentDistance(
  currentMessage: string,
  intent: string
): number {
  const currentTf = termFrequency(tokenize(currentMessage));
  const intentTf = termFrequency(tokenize(intent));
  const sim = cosineSimilarity(currentTf, intentTf);
  return Math.round((1 - sim) * 100) / 100;
}

// --- Message length anomaly ---

function detectMessageLengthAnomaly(
  currentMessage: string,
  previousExchanges: Exchange[]
): boolean {
  if (previousExchanges.length < 2) return false;
  const prevLengths = previousExchanges.map((e) => e.userMessage.length);
  const avgLength = prevLengths.reduce((a, b) => a + b, 0) / prevLengths.length;
  // Anomaly if current message is 2x the average
  return currentMessage.length > avgLength * 2;
}

// --- Mode shift detection ---

function detectModeShift(
  currentAbstraction: number,
  previousExchanges: Exchange[]
): boolean {
  if (previousExchanges.length < 2) return false;
  const prevLevels = previousExchanges.map((e) => e.heuristicFlags.abstractionLevel as number);
  const avgPrev = prevLevels.reduce((a, b) => a + b, 0) / prevLevels.length;
  // Mode shift if abstraction jumped by 2+ from average
  return currentAbstraction - avgPrev >= 2;
}

// --- Abstraction escalation detection (3 consecutive increases) ---

function detectAbstractionEscalation(
  currentLevel: number,
  previousExchanges: Exchange[]
): boolean {
  if (previousExchanges.length < 2) return false;
  const last2 = previousExchanges.slice(-2).map((e) => e.heuristicFlags.abstractionLevel);
  // Check if last2[0] < last2[1] < currentLevel
  return last2.length === 2 && last2[0] < last2[1] && last2[1] < currentLevel;
}

// --- Main heuristics function ---

export function analyzeHeuristics(
  userMessage: string,
  session: { intent: string; budget: number; exchanges: Exchange[] }
): HeuristicFlags {
  const { level: anthropomorphicLevel, markers: anthropomorphicMarkers } =
    detectAnthropomorphicLevel(userMessage);

  const abstractionLevel = scoreAbstractionLevel(userMessage);
  const loopSimilarity = computeLoopSimilarity(userMessage, session.exchanges);
  const tangentDistance = computeTangentDistance(userMessage, session.intent);
  const messageLengthAnomaly = detectMessageLengthAnomaly(userMessage, session.exchanges);
  const modeShiftIndicator = detectModeShift(abstractionLevel, session.exchanges);
  const abstractionEscalation = detectAbstractionEscalation(
    abstractionLevel,
    session.exchanges
  );

  return {
    exchangeCount: session.exchanges.length + 1,
    budgetRemaining: session.budget - session.exchanges.length,
    anthropomorphicMarkers,
    anthropomorphicLevel,
    abstractionLevel,
    abstractionEscalation,
    loopSimilarity,
    messageLengthAnomaly,
    modeShiftIndicator,
    tangentDistance,
  };
}

/**
 * Determine if the LLM classifier should be triggered based on heuristic flags.
 * Hybrid approach: only call LLM when heuristics flag something ambiguous.
 */
export function shouldTriggerClassifier(flags: HeuristicFlags): boolean {
  if (flags.anthropomorphicLevel >= 2) return true;
  if (flags.abstractionEscalation) return true;
  if (flags.loopSimilarity > 0.5) return true;
  if (flags.modeShiftIndicator) return true;
  if (flags.tangentDistance > 0.8) return true;
  if (flags.messageLengthAnomaly) return true;
  return false;
}
