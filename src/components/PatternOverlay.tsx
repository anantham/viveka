"use client";

import { HeuristicFlags, ClassifierFlags, Intervention } from "@/lib/types";

interface PatternOverlayProps {
  heuristics: HeuristicFlags;
  classifier: ClassifierFlags | null;
  intervention: Intervention | null;
}

export default function PatternOverlay({
  heuristics,
  classifier,
  intervention,
}: PatternOverlayProps) {
  const flags: Array<{ label: string; color: string }> = [];

  if (heuristics.anthropomorphicLevel >= 2) {
    const colors = ["", "", "text-amber-400", "text-orange-400", "text-red-400"];
    flags.push({
      label: `Anthropomorphic L${heuristics.anthropomorphicLevel}`,
      color: colors[heuristics.anthropomorphicLevel],
    });
  }

  if (heuristics.abstractionEscalation) {
    flags.push({
      label: `Abstraction escalation L${heuristics.abstractionLevel}`,
      color: "text-amber-400",
    });
  }

  if (heuristics.loopSimilarity > 0.5) {
    flags.push({
      label: `Loop similarity ${Math.round(heuristics.loopSimilarity * 100)}%`,
      color: heuristics.loopSimilarity > 0.7 ? "text-red-400" : "text-amber-400",
    });
  }

  if (heuristics.tangentDistance > 0.7) {
    flags.push({
      label: "Drift from intent",
      color: "text-amber-400",
    });
  }

  if (heuristics.modeShiftIndicator) {
    flags.push({
      label: "Mode shift",
      color: "text-blue-400",
    });
  }

  if (classifier?.interventionRecommended) {
    flags.push({
      label: `Classifier: ${classifier.interventionRecommended}`,
      color: "text-red-400",
    });
  }

  if (flags.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {flags.map((flag, i) => (
        <span
          key={i}
          className={`text-xs px-2 py-0.5 rounded border border-stone-700 ${flag.color}`}
        >
          {flag.label}
        </span>
      ))}
      {intervention && (
        <div
          className={`w-full mt-1 p-2 rounded text-xs border ${
            intervention.type === "stop" || intervention.type === "pause"
              ? "border-red-700 bg-red-950/50 text-red-300"
              : intervention.type === "warning"
                ? "border-amber-700 bg-amber-950/50 text-amber-300"
                : "border-blue-700 bg-blue-950/50 text-blue-300"
          }`}
        >
          {intervention.message}
        </div>
      )}
    </div>
  );
}
