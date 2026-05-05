# Viveka Roadmap

Maps the path from current state to the compression pipeline vision (see `vision.md`).

## Phase 0: Foundation Already Built

These were designed in the founding conversation (`chat context.txt`) and implemented as v0.1.

### From the original ADR-001 design — DONE:
- **Session framing** — mandatory intent declaration, completion condition, mode selection, budget
- **Three session modes** — instrumental, exploratory, reflective with different budgets and intervention profiles
- **Budget depletion meter** — visual exchange counter with soft-lock then hard-lock
- **Pattern detection (heuristic layer)** — abstraction escalation, loop detection, anthropomorphic drift, message length anomaly
- **Pattern detection (LLM classifier)** — background haiku call returning structured JSON flags (novelty_score, intervention_recommended, etc.)
- **Progressive delays** — DelayScreen triggered by pattern flags, with body-awareness prompts
- **Intervention system** — nudge/warning/pause/stop levels, user response logging
- **Completion checks** — "has your stated purpose been fulfilled?" prompts
- **Response degradation** — system prompt shortens responses after exchange 5, strips formatting after 75% budget
- **Session export to Obsidian** — structured markdown with frontmatter, exchange log, pattern metrics
- **Claude Code CLI backend** — subprocess spawn with Max plan OAuth, no API key needed

### Beyond the original design — DONE:
- **Tree data model (LOOM)** — full branching, sibling navigation, active path tracking (original design was linear-only)
- **Multi-completion generation** — N parallel completions with async polling
- **Phrase reroll / inline editing** — select text, regenerate, version history with rollback
- **Expand mode** — 4 sub-modes (threads, tensions, metaphors, full) for creative broadening
- **Node splitting** — tangent/interrupt mid-response, word-boundary snapping
- **Canvas view** — pan/zoom spatial layout with FLIP transitions
- **Reader view** — clean reading surface for the active path
- **Context panel** — Obsidian vault retrieval, enable/disable blocks, token tracking
- **Freeform dump mode** — no AI, just write, with ambient context (music, mood, body state)
- **Draft user suggestions** — AI generates N diverse suggested user replies
- **Intent templates** — quick-start templates with category tagging
- **LLM backend switcher** — Claude, Ollama, LM Studio, OpenRouter with UI settings panel
- **Incubate mode** — timer, silence, soft return

---

## Phase 0.5: Cross-Session Intelligence

**Status (2026-05-05):** **Deferred.** Not started. The May 2026 canvas-redesign sprint (see [SYNTHESIS.md](./experiments/canvas-redesign/SYNTHESIS.md)) took the slot — the writing-exoskeleton vision asked for in-canvas operations (replace, extend, merge, unmerge) before cross-session analysis. Phase 0.5 still lives here as the next-most-natural build target after the current redesign settles, but no work has been done on it.

**Why before new modes:** The original design (chat context) explicitly called for cross-session pattern analysis and declining usage as the success metric. These are core to the attentional scaffolding mission — without them, interventions are reactive (per-session) rather than revealing long-term patterns.

### Cross-Session Pattern Analysis
The original design described: "Your last five sessions show increasing abstraction-escalation. Your declared intentions were met in 2 of 5."

**What to build:**
- Dashboard view (between-session, not in-session) showing:
  - Intention fulfillment rate across sessions
  - Abstraction escalation trends
  - Average session length vs budget
  - Most common pattern flags triggered
  - Mode distribution (instrumental vs exploratory vs reflective)
- Data source: Obsidian session exports (already being written) parsed and aggregated
- Surface patterns to user as ambient information, not judgement

**What exists:** Session exports already contain exchange counts, pattern flags, completion status. The data is there — just no analysis layer.

**Open questions:**
- [ ] Dashboard as a page in Viveka, or as an Obsidian note generated periodically?
- [ ] How many sessions before trends become meaningful?
- [ ] Should the dashboard influence in-session interventions? ("Based on your history, you tend to drift at exchange 4")

### Declining Usage as Success Metric
The original design stated: "The completion stage for the interface itself would be: building something that makes people not need it. The metric of success is declining usage over time, not engagement."

**What to build:**
- Track session frequency, average duration, intervention-to-completion ratio over time
- "Health score" that improves as user needs fewer interventions and meets stated intentions more consistently
- Explicit anti-engagement framing: celebrate when users use Viveka less

**Open questions:**
- [ ] How to distinguish "declining usage because tool works" from "user stopped using it"?
- [ ] Is this a per-user metric, or aggregate for IIT research?
- [ ] Should this be visible to IIT facilitators in therapist mode?

---

## Phase 1: Mode C — Fidelity Check

**Why first:** This is the cheapest mode to build and immediately useful. It validates whether the AI "got it" before any transformation happens. Required by Mode E (concept extraction) and Mode D (style transfer) as a prerequisite — you can't transfer what wasn't received.

**What to build:**
- New session mode or tree operation: "fidelity check"
- AI generates 3 questions about the current content/idea
- AI answers its own questions
- Human confirms, corrects, or rejects each answer
- Results stored as a fidelity score on the node/session

**Open questions:**
- [ ] Should this be a separate mode or a tool available within any mode?
- [ ] What's the UI? Inline Q&A below the text? Side panel? Overlay?
- [ ] How do corrections feed back? Does the AI regenerate answers, or does the human edit?
- [ ] Is fidelity binary (got it / didn't) or graded?
- [ ] Should fidelity checks be exportable as a "transmission receipt"?

---

## Phase 2: Mode E — Concept Extraction

**Why second:** Unlocks the vault-writing direction (currently read-only). Makes Mode B's exploration durable — insights don't die in sessions, they become vault notes.

**What to build:**
- "Extract concept" action on any node or selection
- Minimal note stub: name, one-line definition, intuition, examples
- Write to Obsidian vault with proper tags/links
- Detect when LLM uses a term it doesn't fully grok (via Mode C fidelity signal)
- Prompt to extract the human's understanding into a vault note

**Open questions:**
- [ ] How to detect "novel word not well understood by LLM"? Fidelity check failure? Explicit user trigger? Both?
- [ ] What's the note template? Minimal stub vs structured ontology entry?
- [ ] How does this interact with the existing Obsidian ontology skill (`obsidian-ontology`)?
- [ ] Should extracted concepts auto-link to existing vault notes?
- [ ] Trust accretion model — how do stubs grow over time? Manual only, or does the system prompt revisits?

---

## Phase 3: Mode D — Style Transfer

**Why third:** The publish pipeline (A = B->C->D) needs this to close the loop. Without D, Mode A can't produce audience-ready artifacts.

**What to build:**
- Audience archetype selector (List 2 from vision.md)
- Style transfer operation: takes content (verified via Mode C), rewrites for target audience
- Human reviews output, adjusts tone/register
- Preserve content invariant: the meaning must survive transfer, only presentation changes
- A/B comparison view: original vs transferred side by side

**Open questions:**
- [ ] What is List 1 (style dimensions)? Formality? Density? Metaphor usage? Jargon level?
- [ ] Are audience archetypes fixed or user-extensible?
- [ ] How to verify content preservation during transfer? Diff view? Semantic similarity score?
- [ ] Should transfer be iterative (adjust knobs) or one-shot?
- [ ] Multi-audience: generate for 2-3 audiences simultaneously for comparison?

---

## Phase 4: Mode B — Research & Pull-In

**Why fourth:** Currently the vault is the only external source. Real exploration needs web research, papers, references.

**What to build:**
- Exa MCP integration for semantic web search
- Deep research mode: LLM generates search queries, pulls results, synthesizes
- Self-prompt: AI generates follow-up questions and explores them
- Results become context blocks (reusing existing ContextPanel infrastructure)
- Human guides exploration: "go deeper on X", "that's enough on Y"

**Open questions:**
- [ ] Exa vs Perplexity vs Tavily — which search API? Multiple?
- [ ] How to manage context window with pulled-in material? Summarize vs full text?
- [ ] Does the AI auto-search or only search on explicit request?
- [ ] How does self-prompting work without becoming a runaway loop? Budget/step limit?
- [ ] Should pulled-in material be cached in vault for future sessions?

---

## Phase 5: Mode F — Visual Compaction

**Why fifth:** Becomes essential when sessions get long. The other modes generate content; this mode compresses it.

**What to build:**
- WinDirStat-style treemap: each block = text chunk, area = token count
- Click to preview content
- Actions: remove fully, summarize (compress), preserve (mark as important)
- Compression stack: summarized blocks maintain links to originals
- Visual feedback: see the session "shrink" in real time

**Open questions:**
- [ ] Treemap of what? Nodes in the tree? Paragraphs? Arbitrary text blocks?
- [ ] Does compaction modify the tree or create a new compressed view?
- [ ] How does "compression stack" relate to the tree model? Parallel structure?
- [ ] What's the summary quality bar? LLM summarize vs extractive?
- [ ] Can compaction be undone?

---

## Phase 6: Features & Polish

**These can be interleaved with the phases above as needed:**

### Feature 2: Grab & Move Text
- Allow drag-reordering of nodes within the active path
- Currently tree structure is append-only; need "reparent" or "reorder" operations
- **Open:** Does rearranging change the tree, or create a new "reading order" overlay?

### Feature 4: Predefined Macros
- Narrowing operators (opposite of expand): constrain, validate, prune weak threads
- Predefined checks: logical consistency, factual claims, scope creep
- **Open:** Is this a library of prompts? A rule engine? LLM-as-judge?

### Feature 7: Colored Demarcation
- Color-code text by source: human-typed, human-selected (from completions), AI-generated
- Number sequence showing the order of operations
- **Open:** Inline highlights or margin annotations? How dense before it's noisy?

### Feature 7: Seed-Based Replay
- Store generation parameters (model, temperature, seed if supported) per node
- Export session as replayable script
- **Open:** Not all models support seeds. Approximate replay (same prompt) vs exact?

---

## Open Questions (Cross-Cutting)

### Mode G
- Not defined yet. Candidates:
  - **Collaboration** — multi-human editing with role separation
  - **Evaluation** — systematic quality assessment against criteria
  - **Iteration** — automated refinement loops with convergence detection
  - **Publication** — final formatting, platform-specific export (Twitter thread, Substack, etc.)

### Feature 8
- Not defined yet. Related to Mode G?

### Pipeline Composition
- Vision says A = B->C->D. But how do modes compose beyond this?
- Can you run E from within B? (yes, per vision — triggered when B hits a novel concept)
- Can you run F at any point? Or only at the end?
- Is there a mode transition UI, or is it implicit?

### Data Model
- Current tree model works for branching completions
- Style transfer (Mode D) needs a "content vs presentation" split — is that a new node type?
- Compaction (Mode F) needs a "summary layer" — overlay on the tree? Separate structure?
- Research (Mode B) adds external references — context blocks, or tree nodes with special type?

### Audience Archetype Details
- List 1 (style dimensions) not defined — what are the knobs?
- Archetypes 2 (post-rat) and 4 (academia) not elaborated
- Are archetypes composable? "Academic post-rationalist"?
- Should archetypes be learned from examples rather than defined?

### IIT Integration
- **Facilitator mode:** IIT describes a therapist guiding the client. Should Viveka have a two-seat mode where a facilitator sees the pattern flags and controls interventions while the client interacts with the AI? Or is the tool itself the facilitator?
- **Soloware direction:** IIT emphasizes "reproduce, don't replicate" — tailored solutions per person. Should Viveka learn each user's specific failure modes and adapt intervention profiles over time?
- **IIT session export:** Should Viveka sessions produce artifacts useful for IIT case studies? (Substack posts, anonymized pattern data)
- **Training material:** IIT roadmap mentions courses for therapists. Viveka could be the hands-on training tool — therapists learn by running their own sessions through it.
- **"Separate data and interface" principle:** Viveka already does this for AI chat. Could the same approach extend to other tools the client uses? (email, social media, note-taking) — the "cross-platform awareness" from IIT.
