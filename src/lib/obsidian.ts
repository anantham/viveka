import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { Session } from "./types";
import type { Workspace, Fragment } from "./workspace";

function getVaultPath(): string {
  const path = process.env.OBSIDIAN_VAULT_PATH;
  if (!path) throw new Error("OBSIDIAN_VAULT_PATH not set in .env.local");
  return path;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export async function writeSessionToObsidian(session: Session): Promise<string> {
  const vaultPath = getVaultPath();
  const sessionsDir = join(vaultPath, "viveka", "sessions");
  await mkdir(sessionsDir, { recursive: true });

  const slug = slugify(session.intent);
  const dateStr = formatDate(session.createdAt);
  const filename = `${dateStr}-${slug}.md`;
  const filepath = join(sessionsDir, filename);

  // Compute session metrics
  const patternCounts = {
    abstractionEscalations: session.exchanges.filter(
      (e) => e.heuristicFlags.abstractionEscalation
    ).length,
    loopDetections: session.exchanges.filter(
      (e) => e.heuristicFlags.loopSimilarity > 0.7
    ).length,
    anthropomorphicFlags: session.exchanges.filter(
      (e) => e.heuristicFlags.anthropomorphicLevel >= 2
    ).length,
    modeShifts: session.exchanges.filter(
      (e) => e.heuristicFlags.modeShiftIndicator
    ).length,
    maxAnthropomorphicLevel: Math.max(
      0,
      ...session.exchanges.map((e) => e.heuristicFlags.anthropomorphicLevel)
    ),
  };

  const interventionCount = session.exchanges.filter(
    (e) => e.interventionShown !== null
  ).length;

  // Compute duration
  const startTime = new Date(session.createdAt).getTime();
  const lastExchange = session.exchanges[session.exchanges.length - 1];
  const endTime = lastExchange
    ? new Date(lastExchange.timestamp).getTime()
    : startTime;
  const durationMinutes = Math.round((endTime - startTime) / 60_000);

  // Build markdown
  let md = `---
date: ${session.createdAt}
mode: ${session.mode}
intent: "${session.intent.replace(/"/g, '\\"')}"
completion_condition: "${session.completionCondition.replace(/"/g, '\\"')}"
completion_met: ${session.completionMet ?? false}
exchanges: ${session.exchanges.length}
budget: ${session.budget}
duration_minutes: ${durationMinutes}
patterns:
  abstraction_escalations: ${patternCounts.abstractionEscalations}
  loop_detections: ${patternCounts.loopDetections}
  anthropomorphic_flags: ${patternCounts.anthropomorphicFlags}
  mode_shifts: ${patternCounts.modeShifts}
  max_anthropomorphic_level: ${patternCounts.maxAnthropomorphicLevel}
tags:
  - viveka/session
  - viveka/${session.mode}
---

# Session: ${session.intent}

## Intent
${session.intent}

## Completion Condition
${session.completionCondition} → **${session.completionMet ? "MET" : "NOT MET"}**

## Exchange Summary
`;

  for (const ex of session.exchanges) {
    const userPreview = ex.userMessage.slice(0, 150).replace(/\n/g, " ");
    const flags: string[] = [];

    if (ex.heuristicFlags.abstractionEscalation) {
      flags.push(
        `abstraction escalation (L${ex.heuristicFlags.abstractionLevel})`
      );
    }
    if (ex.heuristicFlags.loopSimilarity > 0.7) {
      flags.push(`loop (sim ${ex.heuristicFlags.loopSimilarity})`);
    }
    if (ex.heuristicFlags.anthropomorphicLevel >= 2) {
      flags.push(
        `anthropomorphic L${ex.heuristicFlags.anthropomorphicLevel}`
      );
    }
    if (ex.heuristicFlags.modeShiftIndicator) {
      flags.push("mode shift");
    }
    if (ex.heuristicFlags.tangentDistance > 0.7) {
      flags.push(`drift (tangent ${ex.heuristicFlags.tangentDistance})`);
    }

    md += `
### Exchange ${ex.index + 1}
**User:** ${userPreview}...
**Pattern flags:** ${flags.length > 0 ? flags.join(", ") : "none"}`;

    if (ex.classifierFlags) {
      md += `
**Classifier:** novelty ${ex.classifierFlags.noveltyScore}, abstraction ${ex.classifierFlags.abstractionLevel}${
        ex.classifierFlags.interventionRecommended
          ? `, intervention: ${ex.classifierFlags.interventionRecommended}`
          : ""
      }`;
    }

    if (ex.interventionShown) {
      md += `
**Intervention:** ${ex.interventionShown.type} — "${ex.interventionShown.message}" → ${ex.userResponseToIntervention ?? "no response"}`;
    }

    md += "\n";
  }

  md += `
## Session Metrics
- Total exchanges: ${session.exchanges.length} / ${session.budget} budget
- Completion: ${session.completionMet ? `met at exchange ${session.exchanges.length}` : "not met"}
- Duration: ${durationMinutes} minutes
- Pattern interventions: ${interventionCount}
- Anthropomorphic level: max ${patternCounts.maxAnthropomorphicLevel}
`;

  await writeFile(filepath, md, "utf-8");
  return filepath;
}

// ---------------------------------------------------------------------------
// Workspace → Obsidian canvas (.canvas) export
// ---------------------------------------------------------------------------

/**
 * Obsidian canvas file format (JSON Canvas 1.0 — see
 * https://jsoncanvas.org/). Subset we use:
 *   - text nodes for fragments
 *   - edges from the workspace's responded-to graph
 *   - x/y from canvasPositions (or a sequence-derived fallback)
 */
interface CanvasNode {
  id: string;
  type: "text";
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string; // 1-6 (red, orange, yellow, green, cyan, purple)
}

interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: "top" | "right" | "bottom" | "left";
  toSide?: "top" | "right" | "bottom" | "left";
  label?: string;
}

interface ObsidianCanvas {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

const NODE_W = 480;
const NODE_H = 200;

/**
 * Map Viveka provenance to Obsidian's 1-6 color slots so the canvas
 * file looks roughly right when opened. Colors don't survive every
 * Obsidian theme but the convention is helpful.
 */
function provenanceToCanvasColor(f: Fragment): string | undefined {
  const t = f.provenance.type;
  if (t === "ai-generated") return "5"; // cyan
  if (t === "merged") return "5"; // cyan-ish (was teal in our palette)
  if (t === "split" || t === "extracted") return "6"; // purple
  if (t === "imported") return "3"; // yellow / amber
  if (t === "human-typed") return "4"; // green
  if (t === "system") return undefined; // default
  return undefined;
}

/** Heuristic height estimate so multi-paragraph fragments don't get clipped. */
function estimateCanvasHeight(content: string): number {
  if (!content) return 80;
  // ~80 chars per line at width 480, plus 24px line height
  const lines = Math.ceil(content.length / 80);
  return Math.max(120, Math.min(800, 24 * lines + 32));
}

/**
 * Build an Obsidian canvas from a Workspace.
 *
 * - Fragments → text nodes. Position from `canvasPositions[id]` if
 *   present; otherwise a left-to-right sequence layout (root → seq).
 * - Edges → all `responded-to`, `derived`, `split-from` edges as
 *   canvas edges. The edge type is preserved as the label so it's
 *   visible in Obsidian.
 * - System root + any orphan fragments are included so re-import
 *   round-trips don't lose data.
 */
export function workspaceToCanvas(ws: Workspace): ObsidianCanvas {
  const nodes: CanvasNode[] = [];
  const seenPositions = new Map<string, { x: number; y: number }>();

  // Fallback layout for fragments without canvasPositions: spread the
  // sequence horizontally; stage column to the right; unplaced below.
  let fallbackX = 0;
  const sequenceSet = new Set(ws.sequence);
  const stageSet = new Set(ws.stageIds);

  for (const id of ws.sequence) {
    const f = ws.fragments[id];
    if (!f) continue;
    const pinned = ws.canvasPositions[id];
    const pos = pinned ?? { x: fallbackX, y: 0 };
    if (!pinned) fallbackX += NODE_W + 60;
    seenPositions.set(id, pos);
    nodes.push({
      id,
      type: "text",
      text: f.content || "(empty)",
      x: pos.x,
      y: pos.y,
      width: NODE_W,
      height: estimateCanvasHeight(f.content),
      color: provenanceToCanvasColor(f),
    });
  }

  let stageY = 0;
  const stageX = fallbackX + 80;
  for (const id of ws.stageIds) {
    if (seenPositions.has(id)) continue;
    const f = ws.fragments[id];
    if (!f) continue;
    const pinned = ws.canvasPositions[id];
    const pos = pinned ?? { x: stageX, y: stageY };
    if (!pinned) stageY += NODE_H + 40;
    seenPositions.set(id, pos);
    nodes.push({
      id,
      type: "text",
      text: f.content || "(empty)",
      x: pos.x,
      y: pos.y,
      width: NODE_W,
      height: estimateCanvasHeight(f.content),
      color: provenanceToCanvasColor(f),
    });
  }

  // Unplaced (sibling alts, etc.) — laid out below the sequence row.
  let unplacedX = 0;
  const unplacedY = NODE_H + 200;
  for (const f of Object.values(ws.fragments)) {
    if (seenPositions.has(f.id)) continue;
    if (!f.content) continue;
    if (sequenceSet.has(f.id) || stageSet.has(f.id)) continue;
    const pinned = ws.canvasPositions[f.id];
    const pos = pinned ?? { x: unplacedX, y: unplacedY };
    if (!pinned) unplacedX += NODE_W + 60;
    seenPositions.set(f.id, pos);
    nodes.push({
      id: f.id,
      type: "text",
      text: f.content || "(empty)",
      x: pos.x,
      y: pos.y,
      width: NODE_W,
      height: estimateCanvasHeight(f.content),
      color: provenanceToCanvasColor(f),
    });
  }

  // Edges — only between nodes we actually emitted.
  const emitted = new Set(nodes.map((n) => n.id));
  const edges: CanvasEdge[] = ws.edges
    .filter((e) => emitted.has(e.from) && emitted.has(e.to))
    .map((e, i) => ({
      id: `edge-${i}`,
      fromNode: e.from,
      toNode: e.to,
      fromSide: "right",
      toSide: "left",
      label: e.type === "responded-to" ? undefined : e.type,
    }));

  return { nodes, edges };
}

export async function writeWorkspaceCanvasToObsidian(
  ws: Workspace,
): Promise<string> {
  const vaultPath = getVaultPath();
  const canvasDir = join(vaultPath, "viveka", "canvases");
  await mkdir(canvasDir, { recursive: true });

  const slug = slugify(ws.intent || "untitled");
  const dateStr = formatDate(ws.createdAt);
  const filename = `${dateStr}-${slug}.canvas`;
  const filepath = join(canvasDir, filename);

  const canvas = workspaceToCanvas(ws);
  await writeFile(filepath, JSON.stringify(canvas, null, 2), "utf-8");
  return filepath;
}

/**
 * Markdown export of just the active sequence — for "I want to read
 * what I wrote in Obsidian." Skips the session-metric frontmatter
 * that writeSessionToObsidian adds; this one is plain prose with a
 * minimal frontmatter (intent + date).
 */
export async function writeWorkspaceProseToObsidian(
  ws: Workspace,
): Promise<string> {
  const vaultPath = getVaultPath();
  const proseDir = join(vaultPath, "viveka", "prose");
  await mkdir(proseDir, { recursive: true });

  const slug = slugify(ws.intent || "untitled");
  const dateStr = formatDate(ws.createdAt);
  const filename = `${dateStr}-${slug}.md`;
  const filepath = join(proseDir, filename);

  const body = ws.sequence
    .map((id) => ws.fragments[id])
    .filter((f): f is Fragment => !!f && !!f.content)
    .filter((f) => f.provenance.type !== "system")
    .map((f) => f.content)
    .join("\n\n");

  const md = `---
date: ${ws.createdAt}
intent: "${ws.intent.replace(/"/g, '\\"')}"
tags:
  - viveka/prose
---

# ${ws.intent}

${body}
`;

  await writeFile(filepath, md, "utf-8");
  return filepath;
}
