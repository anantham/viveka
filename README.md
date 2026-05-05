# Viveka

Viveka is a local-first Next.js prototype for structured human-AI thinking and writing.

It currently combines three interaction surfaces:
- `Linear` sessions: bounded chat with intent declaration, budget, heuristics, delays, and export
- `LOOM`: a fragment-based workspace with reader, tree, chat, and canvas projections
- `Dump`: a freeform writing surface with no AI interruption

The repo is best understood as an experimental interface lab, not a finished product.

## What The Docs Mean

- [vision.md](./docs/vision.md) is the north-star document. It describes the broader attentional-scaffolding and compression-pipeline ambition.
- [ADR-002-workspace-data-model.md](./docs/adr/ADR-002-workspace-data-model.md) is the most important architecture document. Its core data-model decision is implemented.
- [roadmap.md](./docs/roadmap.md) mixes shipped work with near-term aspirations.

Reality check:
- the workspace data model is real
- the Loom/canvas prototype is real
- the bounded linear session flow is real
- the full multi-mode compression pipeline is not built yet
- some requirement sections in the ADR are still design intent, not shipped behavior
- the ADR's cursor-mode language is outdated; the current canvas is gesture-driven

## What Exists Today

### 1. Linear Sessions

The original attentional-scaffolding flow still exists:
- session framing with intent, completion condition, mode, and budget
- heuristic pattern detection during chat
- optional pre-send delays with a `DelayScreen`
- background classifier pass for flagged exchanges
- completion checks and session close/revise flow
- export to Obsidian as structured markdown

Key files:
- [src/app/page.tsx](./src/app/page.tsx)
- [src/components/ChatInterface.tsx](./src/components/ChatInterface.tsx)
- [src/app/api/session/message/route.ts](./src/app/api/session/message/route.ts)

### 2. Loom Workspace

The main active prototype is the workspace interface described in ADR-002:
- fragments as the primitive content unit
- append-only provenance edges
- mutable reading sequence
- stage vs workspace distinction
- spatial canvas positions
- multiple projections of the same state: chat, reader, tree, canvas

Supported operations today include:
- generate parallel completions
- select a completion into the sequence
- split a fragment by text selection
- move fragments between workspace and stage
- inline edit and phrase reroll
- expand from a fragment
- drag on the canvas with force-based layout
- merge fragments on collision hold
- persist canvas positions

Key files:
- [src/lib/workspace.ts](./src/lib/workspace.ts)
- [src/lib/workspace-store.ts](./src/lib/workspace-store.ts)
- [src/components/loom/LoomInterface.tsx](./src/components/loom/LoomInterface.tsx)
- [src/components/loom/WorkspaceCanvas.tsx](./src/components/loom/WorkspaceCanvas.tsx)

### 3. Dump Mode

There is also a simple freeform capture flow:
- create a reflective workspace without the session form ceremony
- append text as fragments without AI interruption
- use it for raw thought capture before structuring

Key files:
- [src/app/api/dump/create/route.ts](./src/app/api/dump/create/route.ts)
- [src/app/api/dump/save/route.ts](./src/app/api/dump/save/route.ts)

### 4. Local Context And Import

Implemented integrations:
- Obsidian vault search and note loading
- Obsidian session export
- Claude conversation import into the linear session store
- persisted intent templates in `.viveka-data/intent-templates.json` when generated

Key files:
- [src/app/api/retrieve/route.ts](./src/app/api/retrieve/route.ts)
- [src/lib/obsidian.ts](./src/lib/obsidian.ts)
- [src/app/api/import/route.ts](./src/app/api/import/route.ts)

### 5. LLM Backends

The app can run against:
- Claude Code CLI
- Ollama
- LM Studio
- OpenRouter

Backend choice is persisted locally and switchable from the UI.

Key files:
- [src/components/LLMSettings.tsx](./src/components/LLMSettings.tsx)
- [src/lib/claude.ts](./src/lib/claude.ts)
- [src/lib/openai-compat.ts](./src/lib/openai-compat.ts)
- [src/lib/llm-config.ts](./src/lib/llm-config.ts)

## What Is Not Built Yet

These show up in the docs but should not be read as current product behavior:
- cross-session analytics dashboard
- declining-usage success metrics
- facilitator mode / therapist workflow
- soloware-style per-user adaptation
- full Mode A/B/C/D/E/F product flows as first-class UI
- true multi-model fan-out across different providers in a single operation
- reproducible session replay from operation logs

## Architecture

### Frontend
- Next.js App Router
- React 19
- local UI state with route handlers rather than a separate backend service

### Persistence

The app is file-backed and single-user by default.

Important local files under `.viveka-data/`:
- `sessions.json`: linear session store
- `workspaces.json`: Loom and dump workspaces
- `llm-config.json`: selected backend and model settings
- `intent-templates.json`: generated intent/category templates
- OpenRouter capability cache files are also written here

### Core Data Structures

The workspace model has four main structures:
- `fragments`
- `edges`
- `sequence`
- `canvasPositions`

Plus `stageIds` for the stage/workspace split.

See [src/lib/workspace.ts](./src/lib/workspace.ts) and [docs/ADR-002-workspace-data-model.md](./docs/adr/ADR-002-workspace-data-model.md).

## Running Locally

### Prerequisites
- Node.js 20+ recommended
- npm
- one working LLM backend:
  - authenticated `claude` CLI, or
  - Ollama, or
  - LM Studio, or
  - OpenRouter API key

### Install

```bash
npm install
```

### Start

```bash
npm run dev
```

Then open `http://localhost:3000`.

### Useful Environment Variables

Optional environment variables used by the app:

```bash
OBSIDIAN_VAULT_PATH=/absolute/path/to/your/vault
VIVEKA_MODEL=sonnet
VIVEKA_LLM_BACKEND=claude
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_MODEL=llama3.2:3b
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=meta-llama/llama-3.1-8b-instant
```

Notes:
- if you use the default Claude path, the app shells out to the local `claude` CLI
- LM Studio is configured from the in-app settings panel rather than a dedicated env var
- Obsidian features require `OBSIDIAN_VAULT_PATH`

## Development Commands

```bash
npm test
npm run build
```

## Recommended Reading Order

If you are new to the repo:
1. read this README
2. read [docs/vision.md](./docs/vision.md) for the larger thesis
3. read [docs/architecture/canvas.md](./docs/architecture/canvas.md) for how the current canvas + workspace works
4. read [docs/experiments/canvas-redesign/SYNTHESIS.md](./docs/experiments/canvas-redesign/SYNTHESIS.md) for the May 2026 phase-transition redesign
5. read [docs/CONVENTIONS.md](./docs/CONVENTIONS.md) for repo patterns
6. ADR-001 and ADR-002 in [docs/adr/](./docs/adr/) are frozen design docs — useful as historical context, not as a current spec

## Summary

Viveka is currently strongest as:
- a bounded chat prototype with attentional interventions
- a fragment-based Loom workspace for branching and arranging thought
- a local-first playground for testing alternative AI interaction structures

It is not yet the full compression-pipeline system described in the vision docs, but the workspace model and Loom surface are real enough that the repo now needs documentation anchored in present behavior rather than only future ambition.
