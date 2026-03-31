# Viveka Vision

## Two Layers

**Layer 1 — Attentional Scaffolding (the mechanism):**
Viveka reshapes the human-AI interaction field. Chat interfaces train humans into slot-machine dynamics and codependency. Viveka introduces structural constraints — session framing, budget depletion, pattern detection, progressive delays — that make the user's interaction patterns visible to themselves. The metric of success is declining usage over time, not engagement. "The completion stage for the interface itself would be: building something that makes people not need it."

**Layer 2 — Compression Pipeline (the purpose):**
Once the scaffolding works, use it as a **compression pipeline** that moves from raw thought to publishable artifact using multiple machines (humans + AI models).

## Relationship to IIT (Interface Integration Therapy)

Viveka is a tool within the broader IIT framework — a social practice for healthier human-technology relationships (see `IIT Handbook and Roadmap March 2026.svg` at project root).

| IIT Commitment | Viveka Implementation |
|---|---|
| **Person-centered** (experience is the primitive) | Session intent declaration, completion condition — the human defines what matters |
| **Intimate/Subterranean** (encounter backgrounded details) | Pattern detection surfaces what's invisible: abstraction escalation, loops, anthropomorphic drift |
| **Everyday Software** (mundane technology made extraordinary) | Redesigning the chat interface — the most mundane AI interaction — with attentional scaffolding |

IIT's "minimal criteria for a session" maps to Viveka's lifecycle: investigation (session framing) -> diagnosis (pattern detection) -> resolution (completion check). IIT's "stage manager" metaphor — orchestrating between mind, work, and technology without caring about content — describes what the intervention system does.

Key IIT concepts not yet in Viveka:
- **Facilitator mode** — a human therapist guiding another person's Viveka session
- **Soloware** — Viveka adapting its intervention profile per user over time
- **Cross-platform awareness** — information stuck in traffic jams across tools (currently vault-only)

## Modes

### Mode A: Publish Pipeline (B -> C -> D)
Write a short story / tweet thread / Substack post.
**Goal:** Artifact ready to publish.

### Mode B: Research & Exploration
Research, pull in, self-prompt, explore an idea. Uses Exa MCP, deep research.
**Goal:** Make human clarify and happy with the reification (intangible thing is now in contact and even internally feels sufficiently stable, in contact).

### Mode C: Fidelity Check
AI model asks questions (list 3) and answers them.
**Goal:** Human can confirm transmission and fidelity.

### Mode D: Style Transfer
AI writes the prose and lets human do style transfer (via List 1). Maintain content while changing target audience (via List 2) and focusing on presentation.

### Mode E: Concept Extraction
Triggered when Mode B encounters a novel word/concept not well understood by LLM (as assessed by Mode C). Extract intuitions and create a note in the vault.

This can be:
- Figuring out why a piece of writing was good/bad/neutral in a specific way
- What abstractions capture the useful parts of that concept
- Examples
- Minimal stub of a note, trusting that over time we will accrete into it

### Mode F: Compaction
Visual (WinDirStat-style) graph showing which text blocks take the most space. Human can prune:
- Remove fully
- Move to compression stack (summarized or preserved fully if important enough)

### Mode G: [TBD]

---

## Features

1. **Select & reroll** — select text and reroll to infill
2. **Grab & rearrange** — grab text and move around to tune context
3. **Multiple completions / tangents** — generate parallel completions, explore tangents
4. **Predefined macros** — tested against: pruning, narrowing, constraints on what is legitimate, logical, valid
5. **Expanding** — creative, metaphors, analogies, go broad
6. **Context arrangement** — pull in relevant context and arrange them: raw or after "processing"
7. **Replicable sessions** — seed + export session so others can recreate the trajectory. Use colored text (numbers) to demarcate human-typed, human-clicks, and AI text in order
8. [TBD]

---

## Audience Archetypes (List 2)

Style transfer targets. Each has distinct epistemic norms, communication patterns, and what counts as "evidence."

### 1. Rationalist / LessWrong
Stage 4 Kegan. High decoupling, systemizers, reductionists, secular materialists, physicalism, will to power, control, reification, map-making. Irked at being part of any social group.

### 2. Post-Rationalist / tpot
[To be elaborated]

### 3. Tribal / Embodied Community
Stage 3 Kegan. Tribal folks, embodied, comfortable with group membership.

### 4. Academia
[To be elaborated]

### 5. Non-Verbal / Kinaesthetic
Non-verbal, embodied: yoga, dance, martial arts, hiking, sports folks. Kinaesthetic intelligence.

---

---

## Origin

Viveka emerged from a conversation (preserved in `chat context.txt`) about Buddhist dependent origination, reification as a failure mode, and the structural problems of chat interfaces. Key insight from that conversation: "Build the interface that detects when the human has reached the point of diminishing returns and structurally interrupts the papañca loop instead of sustaining it." The three-layer architecture (session framing, in-session pattern detection, cross-session analysis) was designed in that same conversation and implemented as v0.1.

---

## Open Questions
- Mode G purpose
- Feature 8
- List 1 (style dimensions) not yet defined
- List 3 (fidelity check question templates) not yet defined
- How modes compose beyond the A pipeline (B->C->D)
- How Mode E integrates with Obsidian vault ontology
- How does IIT facilitator mode work in Viveka? (therapist guiding client's session)
- How does Viveka adapt per-user over time? (soloware direction)
