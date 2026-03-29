import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { Session } from "./types";

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
