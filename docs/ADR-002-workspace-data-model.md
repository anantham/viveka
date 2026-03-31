# ADR-002: Workspace Data Model — Requirements

Status: Draft
Date: 2026-03-31
Author: Aditya / Claude

## Context

Viveka v0.1 uses a `ConversationTree` data model where `TreeNode` = a conversation turn. This was the right starting point but the model constrains what we can build. The fundamental reframe: **text fragments are the primitive, not conversation turns.** The system is not a chat — it's a text workspace with provenance tracking where both humans and AI models are operators on a shared surface.

Before deciding on the data model shape (the HOW), this document captures everything the model needs to support (the WHAT).

---

## Core Principles

### 1. Text is the primitive
A fragment of text is the atom. Everything else — nodes, turns, responses, drafts — is a fragment with metadata. There is no privileged "conversation turn" structure.

### 2. Provenance, not role
The distinction isn't "user message vs assistant response." It's: who produced this fragment and how? Provenance includes:
- **Human typed** — person wrote this text
- **Human gesture** — person split, moved, extracted, rearranged, pruned
- **AI generated** — a specific model produced this text, given a specific prompt, with specific parameters
- Model identity (which model: Claude Sonnet, Llama 3.1 8B, etc.)
- Color codes provenance for the human viewer

### 3. The workspace is the context
When generating a completion, the AI doesn't see a "chat history" — it sees the **entire workspace**, well-indexed: all fragments, their provenance, their arrangement. The workspace snapshot at generation time is the context.

### 4. Reproducibility
The full operation log — every prompt, API call, seed, model, human gesture — is stored so that someone else can replay the session and recreate the trajectory. Colored/numbered text demarcates human-typed, human-clicked, and AI-generated content in order.

### 5. Multi-model generation
A single generation request can fan out to N different AI models (via OpenRouter, Ollama, LM Studio, Claude). Each produces a sibling fragment. The user can pick one, parts of several, or all.

### 6. Views are projections
Chat, tree, canvas, reader — these are all projections of the same underlying workspace state. Changing the arrangement in one view is reflected in all others.

### 7. Workspace vs Stage
Every fragment lives in one of two zones:
- **Workspace** — the "live" surface. Fragments here are in the reading order and visible to the AI during generation. This is the context.
- **Stage** — reference material visible to the human but NOT in the AI's context. Textbooks, articles, vault notes, prior session exports, inspiration. The human can browse, select from, and drag fragments from stage → workspace to include them, or workspace → stage to remove from context without deleting.

The stage is where external material lands when pulled in (Mode B research, vault retrieval, file import). The human curates what crosses the boundary into workspace. This is the structural version of "context arrangement" — not just toggling blocks on/off, but spatially arranging what's in vs out.

---

## Feature Requirements

### F1: Fragment Operations

#### F1.1: Select & Split
- Select a range of text within a fragment
- The fragment splits into 2 or 3 pieces depending on position:
  - Selection at the start → 2 fragments (selection, after)
  - Selection in the middle → 3 fragments (before, selection, after)
  - Selection at the end → 2 fragments (before, selection)
- The selected fragment is now independently movable
- Split is recorded in the operation log with character positions

#### F1.2: Move / Reorder
- Drag a fragment and drop it between two other fragments
- The reading order (sequence) updates
- All views reflect the new order
- Move is recorded in the operation log

#### F1.3: Insert
- Drop a fragment between two others → it inserts into the sequence
- The fragment becomes part of the reading order at that position

#### F1.4: Merge
- Select two adjacent fragments → merge into one
- Provenance becomes "merged" with references to originals

#### F1.5: Prune / Restore
- Remove a fragment from the active workspace (soft delete)
- Pruned fragments are still in the data, just hidden
- Can be restored

#### F1.8: Stage ↔ Workspace Transfer
- Drag a fragment from stage → workspace: it enters the reading order and becomes part of AI context
- Drag a fragment from workspace → stage: it leaves the reading order but remains visible to the human
- Select text within a staged fragment → extract and insert into workspace (steal a quote, a paragraph, an idea)
- Stage fragments retain their provenance (imported article, vault note, prior session)
- The boundary between stage and workspace is the core curation gesture

#### F1.6: Select & Reroll (existing)
- Select text within a fragment, generate alternative phrasings
- Creates sibling fragments (alternatives, not replacements)

#### F1.7: Extract to Vault (Mode E)
- Select a fragment (or text within) → create an Obsidian vault note from it
- The fragment gets a link to the vault note
- Minimal stub: name, definition, intuitions, examples

---

### F2: Generation

#### F2.1: AI Completion
- Given the current workspace state, generate a continuation
- The AI sees ALL fragments with provenance, arrangement, and metadata
- The result is a new fragment with full provenance (model, prompt, seed, params, timing)
- **Full OpenRouter-compatible sampling parameters** stored per-generation:
  - `temperature` (float 0.0-2.0, default 1.0)
  - `top_p` (float 0.0-1.0, default 1.0)
  - `top_k` (integer, default 0)
  - `frequency_penalty` (float -2.0 to 2.0, default 0.0)
  - `presence_penalty` (float -2.0 to 2.0, default 0.0)
  - `repetition_penalty` (float 0.0-2.0, default 1.0)
  - `min_p` (float 0.0-1.0, default 0.0)
  - `top_a` (float 0.0-1.0, default 0.0)
  - `seed` (integer, optional — for reproducible outputs)
  - `max_tokens` (integer)
  - `stop` (string array — stop sequences)
  - `logit_bias` (map of token ID → bias value)
  - `response_format` (json_object, json_schema, etc.)
- Parameters are validated, clamped to limits, and stored in provenance
- Per-model parameter support detection (not all models support all params)
- Reference implementation: LexiconForge `adapters/providers/OpenAIAdapter.ts` has parameter validation, capability checking, and graceful fallback when params aren't supported

#### F2.2: Multi-Model Fan-Out
- Generate N completions, each from a different model
- All models see the same workspace snapshot (frozen at generation time)
- Results appear as sibling fragments for comparison/selection

#### F2.3: AI Self-Prompt
- AI generates follow-up questions or prompts for itself
- These are fragments with provenance type "ai-self-prompt"
- Human can approve, edit, or discard before the AI acts on them

#### F2.4: Human Prompt
- Human writes a prompt/instruction that directs the next generation
- This is a fragment with provenance "human-typed" and a flag indicating it's a directive, not content

#### F2.5: Expand (existing)
- Broaden the thought-space: threads, tensions, metaphors
- Result is new fragments linked to the source

#### F2.6: Context Injection (Stage + Aperture)
- Pull in external material (vault notes, web results, files, articles, textbooks) as fragments
- These land on the **stage** first — visible to human, not in AI context
- Human browses, selects, and drags into workspace to include in context
- Can also select text within staged material and extract just that portion into workspace
- Provenance: "imported" with source reference (URL, file path, vault note link)
- **Aperture controls** (inspired by IndrasNet `context_assembler.py`):
  - Token budget — how much staged material to pull in before hitting limits
  - Source filters — which sources to query (vault, web, files, prior sessions)
  - Relevance window — semantic similarity threshold for auto-suggestions
  - The aperture is the "how wide to open the door" for external material
  - Buttons/shortcuts to pull from each source land results on stage

#### F2.7: Cursor Modes
The primary interaction model is **cursor mode switching** (keyboard-driven):
- **Select mode** (default) — click/drag to select text within fragments. Selection enables: split, reroll, extract, copy
- **Hand mode** (hold Space or toggle) — drag fragments to reposition. On canvas: spatial move. In reader: reorder in sequence
- **Type mode** (Enter on empty space or fragment) — insert new text. Creates a human-typed fragment
- **Pull mode** (shortcut) — opens aperture panel to pull context from vault/web/files onto stage
- Mode switching via keyboard shortcuts. Current mode shown in cursor and status bar

---

### F3: Provenance & Visualization

#### F3.1: Color Coding
- Every fragment is visually coded by provenance:
  - Human-typed text: one color
  - AI-generated (per model): distinct color per model
  - Extracted/split: another color
  - Imported context: another color
- Colors appear in all views consistently

#### F3.2: Operation Numbering
- Each operation (type, split, move, generate, prune) gets a sequential number
- The sequence tells the story of how the workspace was built
- Visible as annotations or on hover

#### F3.3: Lineage Graph
- For any fragment, trace back: what produced this?
- Human typed → direct. AI generated → show prompt, model, seed, workspace snapshot at time of generation. Split → show source fragment and position. Move → show from/to positions.

#### F3.4: Diff View
- Compare workspace state at two points in the operation log
- See what was added, moved, pruned, generated between them

---

### F4: Reproducibility

#### F4.1: Operation Log
- Every mutation to the workspace is recorded:
  - `human-typed`: content, position, timestamp
  - `ai-generated`: prompt, model, seed, params, result, timing, workspace snapshot ID
  - `split`: source fragment, char range, resulting fragment IDs
  - `move`: fragment ID, from position, to position
  - `prune`: fragment ID
  - `merge`: source fragment IDs, result fragment ID
  - `reroll`: source fragment, selection, model, alternatives
- The log is append-only

#### F4.2: Workspace Snapshots
- Before each generation, snapshot the workspace state
- Snapshots are referenced by operation log entries
- Enable: "what did the AI see when it generated this?"

#### F4.3: Session Export / Replay
- Export the operation log + initial state as a replayable artifact
- Someone with the same models and API access can replay and get the same results (given deterministic seeds)
- Export format should be human-readable (JSON + markdown?)

#### F4.4: Full Parameter Storage
- Store ALL generation parameters per-fragment provenance:
  - Model ID (e.g., `meta-llama/llama-3.1-8b-instruct`)
  - All sampling params used (temperature, top_p, top_k, seed, penalties, etc.)
  - System prompt / workspace context snapshot reference
  - Provider (OpenRouter, Ollama, LM Studio, Claude)
  - Response metadata (token counts, cost, timing, finish reason)
- Enables exact reproduction when model + seed support determinism
- Enables approximate reproduction (same prompt + params, different seed) always

---

### F5: Views (Projections)

#### F5.1: Canvas View
- All fragments positioned in 2D space
- Drag to move fragments spatially
- Edges drawn between connected fragments (generative lineage)
- Provenance colors on each fragment
- Spatial proximity = thematic grouping (user-arranged)

#### F5.2: Reader View
- Fragments in reading order as continuous prose
- Provenance shown as inline color/annotations
- Click to select, split, reroll

#### F5.3: Tree View
- Fragments connected by generative edges (what was generated in response to what)
- Branching at fan-out points (multi-model or reroll)
- Active path highlighted

#### F5.4: Chat View (legacy compat)
- Linear sequence of fragments, styled as a conversation
- Alternating human/AI fragments
- Simplest view — may be removed eventually but useful for transition

#### F5.5: Compaction View (Mode F)
- WinDirStat-style treemap: fragment area = token count
- Click to preview, prune, or compress
- Visual feedback on workspace size

#### F5.6: Lineage View
- DAG showing the operation history
- Nodes = operations, edges = what produced what
- Replay controls: step through operations

---

### F6: Attentional Scaffolding (existing, must be preserved)

#### F6.1: Session Framing
- Intent declaration, completion condition, mode, budget
- Must work with the new workspace model

#### F6.2: Pattern Detection
- Heuristic flags + LLM classifier
- Operates on workspace fragments (not conversation turns)
- Abstraction escalation, loops, anthropomorphic drift, diminishing returns

#### F6.3: Budget & Depletion
- Exchange budget → operation budget? Or keep as generation count?
- Progressive delays, response degradation

#### F6.4: Interventions
- Nudge/warning/pause/stop
- Logged as operations in the opLog

#### F6.5: Completion Check
- "Has your stated purpose been fulfilled?"
- Works at workspace level, not conversation level

#### F6.6: Cross-Session Analysis
- Pattern trends across sessions
- Intention fulfillment rate
- Declining usage tracking

---

### F7: Compression Pipeline Modes

#### F7.1: Mode B — Research & Pull-In
- External search (Exa MCP, web)
- Results become fragments with "imported" provenance
- Human arranges and prunes results

#### F7.2: Mode C — Fidelity Check
- AI generates questions about current workspace content
- AI answers its own questions
- Human confirms/corrects
- Questions and answers are fragments with appropriate provenance

#### F7.3: Mode D — Style Transfer
- Select fragments → rewrite for target audience archetype
- Original preserved, rewrite is a new fragment linked to original
- A/B comparison view

#### F7.4: Mode E — Concept Extraction (see F1.7)

#### F7.5: Mode F — Compaction (see F5.5)

---

### F8: Multi-Backend (existing, must be preserved)

#### F8.1: LLM Backend Switcher
- Claude Code, Ollama, LM Studio, OpenRouter
- Per-generation model selection (not just global setting)
- Model identity stored in fragment provenance

---

## What This Document Does NOT Cover

- The specific data model shape (Approach A/B/C from brainstorming) — that's the next decision after these requirements are agreed
- UI design specifics (layouts, interactions, animations)
- Implementation order / phasing
- Performance considerations

---

## Open Questions

1. **Budget model:** Currently "exchange budget" (number of conversation turns). With fragments, what's the budget unit? Number of generation operations? Token count? Time?
2. **Snapshot granularity:** Full workspace snapshot before every generation is expensive for large workspaces. Diff-based? Or snapshot only the fragments in reading order?
3. **Fragment granularity:** What's the minimum meaningful fragment? A word? A sentence? A paragraph? Or is this user-defined (whatever they select)?
4. **Merge semantics:** When merging two fragments with different provenance, what's the resulting provenance? Does it matter?
5. **Mode transitions:** Modes (B, C, D, E, F) are operations on the workspace. Do they change the workspace's "mode" state, or are they just specific operation sequences that can be invoked anytime?
6. **Collaboration:** Should the model support multiple humans operating on the same workspace? (IIT facilitator mode)
7. **Mode G:** Still undefined. Should the data model anticipate any specific capability?
8. **Undo:** The opLog enables undo by replaying. Is that sufficient, or do we need explicit undo operations?
