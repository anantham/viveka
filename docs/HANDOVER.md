# Handover: 2026-03-31

## Session Summary
Built LLM backend switcher (Ollama, LM Studio over Tailscale, OpenRouter) with UI settings panel — gear icon in all interfaces, runtime config persisted to `.viveka-data/llm-config.json`. Then captured the full compression pipeline vision (modes A-G, audience archetypes), mapped the founding conversation (`chat context.txt`) and IIT handbook SVG to current state, and produced vision + roadmap docs.

## Commits This Session
- `44eb602` feat: LLM backend switcher with UI settings panel
- `3530c9f` docs: vision and roadmap with IIT integration and chat context mapping

PUSHED: No (2 commits ahead of origin)

## Pending Threads

### Continue Immediately
1. **Test LLM backend switcher** — built but not tested e2e. Need Ollama (`ollama serve` + `ollama pull llama3.2:3b`) or LM Studio on Tailscale.
2. **Phase 0.5: Cross-session intelligence** — data exists in Obsidian exports, needs dashboard. See `docs/roadmap.md`.

### Blocked
None

### Deferred
1. **Phase 1-5** — Fidelity Check, Concept Extraction, Style Transfer, Research, Visual Compaction. All designed in `docs/roadmap.md`.
2. **IIT Facilitator Mode** — open question in roadmap

## Key Context (This Session)
- **Two-layer framing:** Attentional scaffolding (mechanism) + compression pipeline (purpose). See `docs/vision.md`.
- **IIT is the parent framework.** `IIT Handbook and Roadmap March 2026.svg` at project root. Extract text with: `python3 -c "import re; [print(t) for t in re.findall(r'>([^<]+)<', open('IIT...svg').read()) if len(t.strip())>1]"`
- **LLM backend switcher files:** `src/lib/openai-compat.ts` (adapter), `src/lib/llm-config.ts` (config store), `src/components/LLMSettings.tsx` (UI), `src/app/api/llm-config/route.ts` (API). Routing injected at top of `queryClaudeCode`/`streamClaudeCode` in `claude.ts`.
- **Memory updated:** `project_architecture.md` and new `project_vision_pipeline.md` in auto-memory.

## Resume Instructions
1. Push if ready: `git push`
2. Test LLM backend switcher with a local model
3. Read `docs/roadmap.md` — Phase 0.5 (cross-session intelligence) is next build target
4. Vision has open questions (Mode G, List 1, Feature 8) — discuss before building

---
*Handover by Claude Opus 4.6 at ~60% context*

---
---

# Previous Handover: 2026-03-30

## Session Summary
Built Viveka v0.1 from ADR to working product in one session. Started from a chat context document about Buddhist philosophy and the problem of chat interfaces training craving loops. Built: linear chat with pattern detection, LOOM tree conversations with canvas workbench, freeform dump mode with vault retrieval and AI expansion, incubate timer, reader view. 22 commits, ~7,000 lines of code, deployed to https://github.com/anantham/viveka.

## Commits This Session (main branch)
```
48c2714 feat: reader view — clean reading surface for the active path
51c5b2f feat: incubate mode — timer, silence, soft return
c56b8e3 fix: scroll cycles tools, arrow keys trigger reroll
e488c6e feat: expand mode — AI widens thought-space without narrowing
9f0f281 feat: retrieve mode — auto-detect vault references in freeform dumps
e6b5d18 feat: freeform dump mode — write without questions
8755df1 merge: canvas workbench, star split, local reroll, undo, templates, session adapter
84fb3e9 feat: virtual session adapter, undo UI, intent templates
4548226 feat: star split, local reroll, layout toggle, junction edges, ghost input
1a5b1d1 fix: tangent tool text extraction, single-response system prompt
3e0cb2e feat: generation timing on tree nodes
bdfb9cf feat: Cmd+1/2/3/4 view switching, remove scroll-to-cycle
5835e73 test: add unit tests for canvas-utils and layout-perf (40 tests)
701b509 feat: FLIP transitions and layout perf observability
ba6e2f9 feat: canvas workbench view for free-form text node manipulation
65a9c5c fix: 7 P1/P2 bugs + richer status model + first-class intervention logging
909434a feat: LOOM interface — tree conversations with reroll & draft replies
2e8038b feat: LOOM tree model and API routes
d39ebcb feat: context management — library, per-session blocks, file loading
6a1ad8a feat: UI — session form, chat interface, pattern overlays, timing
aea9023 feat: API routes — session CRUD, messaging, import, classifier
0d907c7 feat: core libraries — Claude CLI wrapper, heuristics, session store
1fde574 feat: scaffold Viveka Next.js project
```

## Pending Threads

### Continue When User Has Tested
1. **Data model unification** — Kill Session/Exchange, make everything a tree. The virtual session adapter is a bridge; full unification is cleaner. Large refactor.
   - Files: `src/lib/types.ts`, `src/lib/session-store.ts`, all session API routes
   - The adapter at `src/lib/tree-session-adapter.ts` is the proof it works

2. **Between-session cooldown timer** — ADR spec, never built. Should show a countdown between sessions preventing immediate re-entry.
   - Small, ~30 min effort
   - Add to home page: if last session ended < N minutes ago, show cooldown

3. **Cross-session analytics dashboard** — Weekly digest, intervention analytics (which warnings get dismissed vs heeded)
   - `src/lib/intervention-log.ts` has `analyzeInterventions()` already
   - Needs a page at `/analytics` and the weekly digest cron script

### Polish (Low Priority)
4. **Snap-to-order indicator** — Visual hint during node drag showing where it'll insert
5. **Smooth reorder animation** — Other nodes shift to make room during drag
6. **Pretext integration** — DOM-free text measurement for 60fps layout transitions. Not needed until view transitions feel janky.

### Deferred (Design Questions)
7. **The "declare, ask, receive, decide, stop" non-chat posture** — User raised this as a fundamental redesign. Not built because the user correctly said to start with specific use cases first. The dump→retrieve→expand→incubate flow IS the first specific use case implemented. More case studies needed before generalizing.

## Key Context

- **Obsidian vault path:** `/Users/aditya/Library/CloudStorage/GoogleDrive-adityaprasadiskool@gmail.com/My Drive/Exocortex/Research/Interfaces/NonChat`
- **Dev server:** `cd viveka && npm run dev` on port 3000
- **Claude CLI:** Uses Max plan OAuth, no API key. `--bare` flag breaks OAuth — don't use it.
- **Model config:** `VIVEKA_MODEL=sonnet` in `.env.local` (fast). Change to `opus` for depth.
- **Session data:** `.viveka-data/sessions.json`, `.viveka-data/trees.json`, `.viveka-data/context-library.json`, `.viveka-data/intent-templates.json`
- **Intent templates:** 30 templates from analyzing 1,297 Claude.ai conversations. Wired into session form dropdown.
- **Imported conversations:** 5 conversations imported from backup at `/Users/aditya/Documents/backup/Claude/data-2026-03-29-04-48-49-batch-0000/`
- **Chat context:** The original conversation that inspired Viveka is at `/Users/aditya/Documents/Ongoing Local/Project 21 NonChat Interface/chat context.txt` — deeply philosophical exchange about dependent origination, craving loops, and why chat interfaces are harmful.
- **ADR:** `/Users/aditya/Documents/Ongoing Local/Project 21 NonChat Interface/ADR1.md`

## Running Processes
- Dev server — PID via `lsof -ti:3000` — `npm run dev` in viveka directory

## Resume Instructions
1. User should test the dump→retrieve→expand→incubate→LOOM flow end-to-end with a real inspiration
2. Collect specific friction points from that testing
3. Build from those specifics, not from the remaining feature list
4. If user asks to keep building features: cooldown timer is the smallest useful addition
5. If architectural: data model unification is the highest-leverage refactor

---
*Handover by Claude Opus 4.6 at high context usage*
