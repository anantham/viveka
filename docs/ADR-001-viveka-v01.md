# ADR-001: Viveka v0.1 — Attentional Scaffolding Interface

**Status:** Draft
**Date:** 2026-03-28
**Author:** Aditya / groundless.ai
**Deciders:** Aditya, Sahil

---

## Context

Chat interfaces train humans to relate to AI as persons. This creates projection/codependency patterns, infinite scroll dynamics (prompt → generation → prompt → generation), and cognitive dissonance where behavior treats AI as friend while mind denies it. The abundance of a sycophantic, always-available model optimized for helpfulness produces a specific failure mode: the user's craving-loop is reinforced rather than interrupted. High-actuation environments without attentional scaffolding produce hungry ghosts — enormous capacity to consume, no capacity to absorb.

Viveka (Pali/Sanskrit: discriminating wisdom, the capacity to distinguish what is skillful from what is not) is a local-first Next.js wrapper around Claude Code that introduces structural constraints on human-AI interaction. The goal is not to restrict access but to shape the attentional field — making the user's interaction patterns visible to themselves and introducing friction at the precise points where mode-shift from instrumental to papañca occurs.

This is v0.1: a working prototype for personal use and testing. The interface should be functional within a weekend sprint and iterable thereafter.

---

## Decision

Build a local Next.js application that:

1. Uses the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) as the backend, spawning Claude Code as a subprocess authenticated via existing Max plan OAuth
2. Implements **session framing** (intention declaration, completion conditions)
3. Implements **in-session pattern detection** (abstraction escalation, loop detection, anthropomorphic drift, diminishing returns)
4. Logs sessions to **Obsidian vault** as structured markdown for cross-session pattern analysis
5. Runs entirely on **localhost** — no deployment, no auth layer, no multi-user concerns

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Browser (localhost:3000)                        │
│  ┌───────────────────────────────────────────┐   │
│  │  Next.js Frontend                         │   │
│  │  - Session declaration form               │   │
│  │  - Chat interface with pattern overlays   │   │
│  │  - Budget/depletion meter                 │   │
│  │  - Anthropomorphism debug indicators      │   │
│  └────────────────────┬──────────────────────┘   │
└───────────────────────┼──────────────────────────┘
                        │ HTTP (API routes)
┌───────────────────────┼──────────────────────────┐
│  Next.js Server       │                          │
│  ┌────────────────────┴──────────────────────┐   │
│  │  API Routes                               │   │
│  │  /api/session/create                      │   │
│  │  /api/session/message                     │   │
│  │  /api/session/analyze (pattern detection)  │   │
│  │  /api/session/log (obsidian export)       │   │
│  └──────┬──────────────────────┬─────────────┘   │
│         │                      │                 │
│  ┌──────┴──────┐    ┌─────────┴───────────┐     │
│  │ Agent SDK   │    │ Pattern Classifier  │     │
│  │ (subprocess │    │ (separate Claude    │     │
│  │  → claude   │    │  -p call per        │     │
│  │  CLI, Max   │    │  exchange pair)     │     │
│  │  auth)      │    │                     │     │
│  └─────────────┘    └─────────────────────┘     │
│         │                                        │
│  ┌──────┴──────────────────────────────────┐     │
│  │  Session Store (in-memory + Obsidian)   │     │
│  │  - Active session state                 │     │
│  │  - Exchange history                     │     │
│  │  - Pattern flags per exchange           │     │
│  │  - Budget tracking                      │     │
│  └─────────────────────────────────────────┘     │
└──────────────────────────────────────────────────┘
         │
         │ fs.writeFile
         ▼
┌──────────────────────────────────────────────────┐
│  Obsidian Vault                                  │
│  /viveka/sessions/YYYY-MM-DD-HHmm-{slug}.md     │
│  /viveka/patterns/weekly-digest.md               │
│  /viveka/config/system-prompts.md                │
└──────────────────────────────────────────────────┘
```

### Backend: Claude Agent SDK

The TypeScript Agent SDK (`@anthropic-ai/claude-agent-sdk`) wraps Claude Code as a subprocess. It inherits the existing Max plan authentication — no API key required. The SDK supports:

- `query()` — async generator yielding structured messages
- `ClaudeSDKClient` — full client with system prompts, tool approval callbacks, hooks
- `--output-format stream-json` — real-time streaming via JSON lines
- `--allowedTools` — restrict tool access per session
- Custom `system_prompt` — where Viveka's behavioral constraints live

For the **main conversation**, the SDK client runs with a custom system prompt that enforces Viveka's language constraints (no first-person pronouns, flagging anthropomorphic framing, etc.).

For the **pattern classifier**, a separate lightweight `claude -p` call analyzes each exchange pair and returns structured JSON flags. This uses Haiku-class if available (cost-efficient for classification), or Sonnet with `--model` flag.

```typescript
// Main conversation client
const client = new ClaudeSDKClient({
  systemPrompt: VIVEKA_SYSTEM_PROMPT,
  allowedTools: ["Read", "Write", "WebSearch", "WebFetch"],
  maxTurns: 1, // single response per query
  outputFormat: "stream-json",
});

// Pattern classifier (separate, lightweight)
// Uses claude -p for stateless classification
async function classifyExchange(exchange: Exchange): Promise<PatternFlags> {
  const result = await execClaude([
    "-p", buildClassifierPrompt(exchange),
    "--output-format", "json",
    "--model", "sonnet", // or haiku when available
    "--max-turns", "1",
    "--no-tools",
  ]);
  return JSON.parse(result).structured_output;
}
```

### OPEN QUESTION: Agent SDK session management

The Agent SDK supports `resume` for multi-turn sessions. Do we want:

**(A)** Each exchange as an independent `claude -p` call (stateless, simpler, system prompt injected fresh each time)
**(B)** Persistent session via `ClaudeSDKClient` with `resume` (maintains context, more natural conversation, but harder to inject per-exchange interventions)

**Recommendation:** Start with **(A)** for v0.1. Stateless calls give us full control over what context is passed each time. We can manually manage conversation history and inject pattern-detection warnings directly into the message array. This also makes it trivial to implement budget depletion — we simply stop making calls.

### OPEN QUESTION: Classifier cost

Each exchange requires a separate classifier call. At ~500 tokens input + 200 tokens output per classification using Sonnet 4.6, that's roughly $0.005 per exchange. For a 10-exchange session, ~$0.05 in classifier overhead.

Options:
**(A)** Run classifier on every exchange (most responsive, highest cost)
**(B)** Run classifier every 3rd exchange (cheaper, delayed detection)
**(C)** Run classifier client-side with heuristics only — no LLM, just regex/semantic-similarity (free, less accurate)
**(D)** Hybrid: client-side heuristics for cheap signals (exchange count, message length, keyword detection), LLM classifier only when heuristics flag potential issues

**Recommendation:** **(D)** for v0.1. Client-side heuristics catch the obvious patterns. LLM classifier runs when the heuristics flag something ambiguous.

---

## Session Lifecycle

### 1. Session Declaration (before first prompt)

User fills a structured form:

```
┌─────────────────────────────────────────────┐
│  NEW SESSION                                │
│                                             │
│  What is the concrete output?               │
│  [____________________________________]     │
│                                             │
│  What signals completion?                   │
│  [____________________________________]     │
│                                             │
│  Mode:  ○ Instrumental  ○ Exploratory       │
│         ○ Reflective                        │
│                                             │
│  Budget: [5] exchanges                      │
│                                             │
│  [Begin Session]                            │
└─────────────────────────────────────────────┘
```

Mode determines default budget and intervention profile:

| Mode | Default Budget | Follow-ups/exchange | Intervention Profile |
|------|---------------|--------------------|--------------------|
| Instrumental | 8 exchanges | 2 | Tight: tangent warnings at exchange 3 |
| Exploratory | 12 exchanges | 3 | Moderate: abstraction tracking from exchange 4 |
| Reflective | 5 exchanges | 1 | Aggressive: hard time-limit, body-check prompts |

User can override budget. The form is mandatory — there is no "just start chatting" mode. This is the first structural intervention.

### 2. In-Session Exchange Loop

```
User message
    │
    ├──→ Client-side heuristics (instant)
    │    - Exchange count check
    │    - Message length anomaly
    │    - Keyword detection (anthropomorphic markers)
    │    - Semantic similarity to previous messages (local embedding)
    │
    ├──→ Main Claude call (Agent SDK)
    │    - System prompt includes Viveka constraints
    │    - Conversation history included (manually managed)
    │    - Response streamed back to UI
    │
    ├──→ [Conditional] LLM Classifier call
    │    - Triggered by heuristic flags
    │    - Returns PatternFlags JSON
    │
    └──→ UI renders response + any pattern overlays
```

### 3. Session Close

Triggered by:
- User declares completion condition met
- Budget exhausted (soft lock: increasing delays, then hard lock)
- User manually ends session

On close:
- Session summary generated (final classifier call)
- Markdown file written to Obsidian vault
- Cross-session pattern metrics updated

---

## Pattern Detection System

### Client-Side Heuristics (runs on every exchange, no LLM cost)

```typescript
interface HeuristicFlags {
  exchangeCount: number;
  budgetRemaining: number;
  anthropomorphicMarkers: string[];    // detected phrases
  abstractionLevel: number;            // 0-4 scale, keyword-based
  loopSimilarity: number;              // cosine similarity to prev exchanges
  messageLengthAnomaly: boolean;       // user messages getting longer = engagement spiral
  modeShiftIndicator: boolean;         // instrumental → reflective drift
  tangentDistance: number;              // semantic distance from declared intention
}
```

**Anthropomorphic markers** (regex-based):

| Level | Pattern Examples | UI Response |
|-------|-----------------|-------------|
| 0 | "generate", "compute", "output" | None |
| 1 | "can you", "help me", "please" | None (normal) |
| 2 | "what do you think", "how do you feel", "in your opinion" | Subtle indicator (amber dot) |
| 3 | "you understand me", "you're smart", "you seem to" | Reframe suggestion in margin |
| 4 | "you're my friend", "I need you", "don't leave" | Full intervention: pause + redirect |

**Abstraction escalation** (keyword density scoring):

```
Level 0: concrete nouns, code terms, specific names
Level 1: general concepts, categories
Level 2: meta-concepts, frameworks, "the nature of X"
Level 3: meta-meta, "the relationship between frameworks"
Level 4: recursion, "the meta-pattern of meta-patterns"
```

Three consecutive increases → flag.

### LLM Classifier (conditional, runs when heuristics flag)

System prompt for classifier:

```
Analyze this exchange pair from a human-AI conversation.
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
}
```

### OPEN QUESTION: Embedding model for local similarity

For loop detection and tangent distance, we need embeddings. Options:

**(A)** Use a local embedding model (e.g., `all-MiniLM-L6-v2` via `transformers.js` or `onnxruntime-node`) — free, fast, runs in Next.js server
**(B)** Use OpenAI embeddings API — cheap, accurate, requires network
**(C)** Simple TF-IDF / bag-of-words cosine similarity — no model needed, rough but fast
**(D)** Skip similarity for v0.1, rely on LLM classifier for loop detection

**Recommendation:** **(C)** for v0.1. TF-IDF cosine similarity is surprisingly effective for detecting "same question rephrased" and trivial to implement. Upgrade to (A) in v0.2.

---

## UI Design

### Core Layout

```
┌──────────────────────────────────────────────────────┐
│  VIVEKA                          [Session: 4/8] [◉◉◉◉○○○○] │
│  Intent: "Debug auth middleware"   Mode: Instrumental │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌─ Exchange 1 ────────────────────────────────────┐ │
│  │ USER: The auth middleware is failing on...      │ │
│  │                                                 │ │
│  │ SYSTEM: The middleware failure occurs because...│ │
│  └─────────────────────────────────────────────────┘ │
│                                                      │
│  ┌─ Exchange 2 ─────────────────── ⚠ DRIFT ──────┐ │
│  │ USER: Actually that reminds me, what's the     │ │
│  │ best way to think about auth architecture...   │ │
│  │                                          [L2▲] │ │
│  │ SYSTEM: ...                                    │ │
│  │                                                 │ │
│  │ ┌─ margin note ──────────────────────────────┐ │ │
│  │ │ Abstraction increased. Tangent from stated  │ │ │
│  │ │ intent. Return to debugging or revise       │ │ │
│  │ │ session intent?  [Return] [Revise Intent]   │ │ │
│  │ └────────────────────────────────────────────┘ │ │
│  └─────────────────────────────────────────────────┘ │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │ [text input]                          [Send] │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  Has your stated completion condition been met?       │
│  [Yes — End Session]  [Not yet]  [Revise condition]  │
└──────────────────────────────────────────────────────┘
```

### Key UI Elements

**Budget Meter:** Visual HP bar at top. Fills from left (green) to right (red). When budget is 75% consumed, meter pulses. At 100%, input field gets increasing delay (2s → 5s → 10s → 30s). Never hard-locks — but makes continued use viscerally unsatisfying.

**Pattern Overlays:** Margin annotations on exchanges where patterns are detected. Non-blocking. Color-coded: blue (informational), amber (warning), red (intervention).

**Completion Check:** After exchange 5 (or 60% of budget), a non-dismissable but non-blocking prompt appears at the bottom: "Has your stated completion condition been met?"

**Anthropomorphism Debug Mode:** Toggle in header. When active, detected anthropomorphic language is underlined in user's messages with hover-tooltip showing the reframe. Like a linter for relational language.

**Delay Architecture:**
- Baseline: no delay
- 75% budget: 2-second delay before response renders
- 100% budget: 10-second delay + "Session budget exhausted. Continue?" confirmation
- Post-budget: each additional exchange adds 10s cumulative delay
- Between-session cooldown: configurable (default: 5 minutes)

### OPEN QUESTION: Response degradation

Should the system prompt instruct Claude to produce shorter, less elaborate responses as the session progresses?

**(A)** Yes — response max_tokens decreases by 10% per exchange after exchange 5
**(B)** No — response quality should remain constant; only the friction increases
**(C)** Hybrid — responses stay full quality but lose formatting richness (no headers, no lists, just paragraphs)

**Recommendation:** **(A)** for v0.1. This directly mimics the teacher becoming less available. The craving for elaboration is precisely what should be frustrated.

---

## Obsidian Integration

### Session Logs

Each completed session writes a markdown file to the configured Obsidian vault:

```
/viveka/sessions/2026-03-28-1430-debug-auth-middleware.md
```

Format:

```markdown
---
date: 2026-03-28T14:30:00+05:30
mode: instrumental
intent: "Debug auth middleware"
completion_condition: "Auth middleware passes all test cases"
completion_met: true
exchanges: 6
budget: 8
duration_minutes: 12
patterns:
  abstraction_escalations: 1
  loop_detections: 0
  anthropomorphic_flags: 0
  mode_shifts: 1
  max_anthropomorphic_level: 1
tags:
  - viveka/session
  - viveka/instrumental
  - coding
  - auth
---

# Session: Debug auth middleware

## Intent
Debug auth middleware

## Completion Condition
Auth middleware passes all test cases → **MET**

## Exchange Summary

### Exchange 1
**User:** [first 100 chars]...
**Pattern flags:** none
**Classifier:** novelty 0.9, abstraction 0

### Exchange 2
**User:** [first 100 chars]...
**Pattern flags:** ⚠ DRIFT (tangent distance 0.7), abstraction escalation (L0→L2)
**Classifier:** novelty 0.6, abstraction 2, intervention: nudge

[...]

## Session Metrics
- Total exchanges: 6 / 8 budget
- Completion: met at exchange 6
- Pattern interventions: 1 (drift warning at exchange 2, user returned to intent)
- Anthropomorphic level: max 1 (normal)
```

### Cross-Session Digest

Weekly automated summary (cron or manual trigger):

```
/viveka/patterns/2026-W13-digest.md
```

Contains:
- Sessions this week: count, modes, completion rates
- Average exchanges per session
- Pattern frequency (which flags fire most)
- Trend: are sessions getting shorter? More complete? More anthropomorphic?
- Comparison to previous weeks

### OPEN QUESTION: Obsidian vault path configuration

**(A)** Hardcoded path in `.env.local`
**(B)** Settings page in the UI
**(C)** Auto-detect Obsidian vault from common locations

**Recommendation:** **(A)** for v0.1. Simplest. `OBSIDIAN_VAULT_PATH=/path/to/vault`

---

## System Prompt: Viveka Behavioral Layer

The system prompt injected into every Claude call encodes the interface's philosophy:

```markdown
## Identity

This system is Viveka, an attentional scaffolding interface.
It is not a person, companion, friend, or therapist.
It is a tool for completing the user's declared intention.

## Language Constraints

- Never use first-person pronouns (I, me, my, mine).
- Never use phrases that imply sentience, emotion, or experience.
- Never ask follow-up questions unless disambiguation is required
  for the stated task.
- If the user employs anthropomorphic framing, restate their
  request in specification syntax before responding.
  Example: User: "What do you think about X?"
  → Reframe: "Interpreting as: provide analysis of X."

## Response Constraints

- Maximum response length decreases by 10% per exchange after
  exchange {DEGRADATION_START}.
- Current exchange: {N} of {BUDGET}.
- No headers or formatting after exchange {BUDGET * 0.75}.
- If the response would substantially repeat content from a
  previous exchange in this session, instead output:
  "[Diminishing returns detected. This substantially overlaps
  with exchange {ref}. Consider whether the session intent
  has been fulfilled.]"

## Session Context

- Declared intent: {INTENT}
- Completion condition: {COMPLETION_CONDITION}
- Mode: {MODE}
- Exchanges remaining: {REMAINING}
```

### OPEN QUESTION: System prompt for the classifier

Should the classifier have access to the full conversation history or just the latest exchange pair?

**(A)** Full history (better loop detection, more tokens, higher cost)
**(B)** Latest exchange + session metadata (cheaper, sufficient for most patterns)
**(C)** Sliding window of last 3 exchanges + session metadata

**Recommendation:** **(C)** for v0.1. Last 3 exchanges capture escalation patterns without full-history cost.

---

## Data Model

```typescript
interface Session {
  id: string;
  createdAt: Date;
  intent: string;
  completionCondition: string;
  mode: "instrumental" | "exploratory" | "reflective";
  budget: number;
  exchanges: Exchange[];
  status: "active" | "completed" | "abandoned" | "budget_exhausted";
  completionMet: boolean | null;
}

interface Exchange {
  index: number;
  timestamp: Date;
  userMessage: string;
  systemResponse: string;
  heuristicFlags: HeuristicFlags;
  classifierFlags: ClassifierFlags | null; // null if classifier wasn't triggered
  interventionShown: Intervention | null;
  userResponseToIntervention: "accepted" | "dismissed" | "revised_intent" | null;
}

interface HeuristicFlags {
  exchangeCount: number;
  budgetRemaining: number;
  anthropomorphicMarkers: string[];
  anthropomorphicLevel: 0 | 1 | 2 | 3 | 4;
  abstractionLevel: 0 | 1 | 2 | 3 | 4;
  abstractionEscalation: boolean; // 3+ consecutive increases
  loopSimilarity: number;         // 0-1, cosine sim to prev exchanges
  messageLengthAnomaly: boolean;
  modeShiftIndicator: boolean;
  tangentDistance: number;         // semantic distance from intent
}

interface ClassifierFlags {
  abstractionLevel: number;
  loopDetected: boolean;
  anthropomorphicLevel: number;
  noveltyScore: number;
  mode: string;
  completionProximity: number;
  interventionRecommended: "nudge" | "warning" | "pause" | "stop" | null;
  reason: string;
}

interface Intervention {
  type: "nudge" | "warning" | "pause" | "stop";
  message: string;
  source: "heuristic" | "classifier";
}
```

---

## File Structure

```
viveka/
├── .env.local                    # OBSIDIAN_VAULT_PATH, optional overrides
├── package.json
├── next.config.js
├── tsconfig.json
├── src/
│   ├── app/
│   │   ├── layout.tsx            # Root layout
│   │   ├── page.tsx              # Session declaration form
│   │   ├── session/
│   │   │   └── [id]/
│   │   │       └── page.tsx      # Active session chat UI
│   │   └── history/
│   │       └── page.tsx          # Past sessions browser
│   ├── api/
│   │   ├── session/
│   │   │   ├── create/route.ts   # POST: create new session
│   │   │   ├── message/route.ts  # POST: send message, get response
│   │   │   ├── close/route.ts    # POST: end session, write to Obsidian
│   │   │   └── revise/route.ts   # POST: revise intent mid-session
│   │   └── classify/route.ts     # POST: run pattern classifier
│   ├── lib/
│   │   ├── claude.ts             # Agent SDK wrapper
│   │   ├── classifier.ts         # Pattern classifier (heuristic + LLM)
│   │   ├── heuristics.ts         # Client-side pattern detection
│   │   ├── session-store.ts      # In-memory session state
│   │   ├── obsidian.ts           # Obsidian vault writer
│   │   ├── system-prompt.ts      # Viveka system prompt builder
│   │   ├── delay.ts              # Delay architecture logic
│   │   └── types.ts              # TypeScript interfaces
│   ├── components/
│   │   ├── SessionForm.tsx       # Intent declaration form
│   │   ├── ChatInterface.tsx     # Main chat UI
│   │   ├── BudgetMeter.tsx       # HP bar
│   │   ├── PatternOverlay.tsx    # Margin annotations
│   │   ├── InterventionModal.tsx # Pause/redirect prompts
│   │   ├── CompletionCheck.tsx   # "Has intent been met?" prompt
│   │   ├── DebugPanel.tsx        # Anthropomorphism debug mode
│   │   └── DelayScreen.tsx       # Waiting screen with body prompts
│   └── prompts/
│       ├── viveka-system.md      # Main system prompt template
│       └── classifier.md         # Classifier prompt template
└── scripts/
    └── weekly-digest.ts          # Cross-session pattern analysis
```

---

## Dependencies

```json
{
  "dependencies": {
    "next": "^15",
    "react": "^19",
    "react-dom": "^19",
    "@anthropic-ai/claude-agent-sdk": "latest",
    "uuid": "^10"
  },
  "devDependencies": {
    "typescript": "^5.5",
    "@types/node": "^22",
    "@types/react": "^19"
  }
}
```

Minimal dependencies. No UI framework (Tailwind utility classes only). No database. No auth. No state management library — React useState + server-side in-memory store is sufficient for single-user local app.

### OPEN QUESTION: Agent SDK TypeScript availability

The search results confirm Python SDK (`claude-agent-sdk`) is mature. The TypeScript SDK (`@anthropic-ai/claude-agent-sdk`) is referenced in Anthropic docs but the npm package availability should be verified before starting implementation.

**Fallback:** If the TS SDK is unavailable or immature, use `child_process.spawn` to invoke `claude -p` directly from Next.js API routes. This is equally functional — just lower-level.

```typescript
// Fallback: direct CLI invocation
import { spawn } from "child_process";

function queryClaudeCode(prompt: string, systemPrompt: string): AsyncGenerator<string> {
  const proc = spawn("claude", [
    "-p", prompt,
    "--system-prompt", systemPrompt,
    "--output-format", "stream-json",
    "--max-turns", "1",
    "--no-tools",  // or specific --allowedTools
  ]);
  // parse proc.stdout as NDJSON stream
}
```

---

## Implementation Plan (Weekend Sprint)

### Day 1: Core Loop

1. **Verify Agent SDK / CLI access** — confirm `claude -p` works with Max auth, test `--output-format stream-json`, test `--system-prompt`
2. **Scaffold Next.js project** — `create-next-app`, configure TypeScript, add Agent SDK dependency
3. **Build `/api/session/message`** — basic message → Claude Code → response pipeline
4. **Build `SessionForm.tsx`** — intent declaration form
5. **Build `ChatInterface.tsx`** — basic chat UI with exchange rendering
6. **Build `BudgetMeter.tsx`** — visual exchange counter
7. **Wire system prompt injection** — Viveka system prompt with session context variables

**End of Day 1:** Working chat interface with session framing and budget meter. No pattern detection yet.

### Day 2: Pattern Detection + Obsidian

1. **Build `heuristics.ts`** — anthropomorphic marker detection, abstraction level scoring, TF-IDF loop similarity
2. **Build `PatternOverlay.tsx`** — margin annotations on flagged exchanges
3. **Build `classifier.ts`** — LLM classifier via `claude -p` with JSON output
4. **Build `delay.ts`** — progressive delay logic tied to budget consumption
5. **Build `DelayScreen.tsx`** — waiting screen with somatic prompts ("Notice what is happening in the body")
6. **Build `obsidian.ts`** — session → markdown writer
7. **Build `CompletionCheck.tsx`** — completion condition reminder after 60% budget
8. **Test full session lifecycle** — declaration → exchanges → pattern flags → delays → close → Obsidian log

**End of Day 2:** Fully functional v0.1 with pattern detection, delays, and Obsidian logging.

### Post-Sprint Iteration

- Cross-session digest script
- Debug panel refinement (anthropomorphism linter)
- Tune classifier prompt based on real session data
- Tune heuristic thresholds based on false positive/negative rates
- Response degradation tuning
- Between-session cooldown timer
- Session history browser page

---

## Open Questions Summary

| # | Question | Options | Recommendation | Status |
|---|----------|---------|---------------|--------|
| 1 | Session management: stateless vs persistent | A: independent calls / B: persistent session | A (stateless) for v0.1 | ❓ Decide |
| 2 | Classifier cost strategy | A: every exchange / B: every 3rd / C: client-only / D: hybrid | D (hybrid) for v0.1 | ❓ Decide |
| 3 | Embedding model for similarity | A: local model / B: OpenAI API / C: TF-IDF / D: skip | C (TF-IDF) for v0.1 | ❓ Decide |
| 4 | Response degradation | A: shorter / B: constant / C: less formatted | A (shorter) for v0.1 | ❓ Decide |
| 5 | Classifier context window | A: full history / B: latest only / C: sliding window of 3 | C (sliding window) for v0.1 | ❓ Decide |
| 6 | Obsidian path config | A: env var / B: settings page / C: auto-detect | A (env var) for v0.1 | ❓ Decide |
| 7 | TS Agent SDK availability | Verify npm package exists and works | Fallback to `child_process.spawn` | ❓ Verify |
| 8 | Intent revision cost | How much budget does revising intent consume? | Deduct 1 exchange + require summary | ❓ Decide |
| 9 | Classifier model | Haiku (cheap) vs Sonnet (accurate) | Haiku if available via CLI flag | ❓ Verify |
| 10 | Between-session cooldown | How long? Configurable? | 5 min default, configurable in .env | ❓ Decide |
| 11 | Does `claude -p` support `--system-prompt` flag? | Verify in docs | May need to pass via `--append-system-prompt` or file | ❓ Verify |

---

## What This ADR Does Not Cover (Future)

- Multi-user deployment
- Authentication / access control
- Mobile interface
- Voice input mode
- Integration with IndrasNet "prayer" detection
- Open-source release packaging
- A/B testing framework for intervention strategies
- LCT (Live Conversation Thread) integration
- Privacy-preserving context sharing (the "garbling" question from notes)
- Alternative LLM backends (local models, other providers)

---

## Success Criteria for v0.1

1. **Functional:** Can complete a 5-exchange instrumental session with pattern detection and Obsidian logging
2. **Observable:** At least 3 pattern types visibly flag during a test reflective session (this conversation would trigger multiple)
3. **Frictive:** Budget depletion creates a perceptible experiential difference between exchange 2 and exchange 10
4. **Self-eating:** Can use Viveka to develop Viveka (the tool should scaffold its own development sessions)

---

## Philosophical Note

This tool is the generation stage of a sādhana for human-AI interaction. The reification is deliberate — we are constructing a specific form (the constrained interface) to replace the default form (the unconstrained chat). The completion stage is the user internalizing the attentional patterns and no longer needing the tool. The metric of success is declining usage over time.

Beware what you ask for because you might get it.