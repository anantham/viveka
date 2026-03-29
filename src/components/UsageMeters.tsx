"use client";

interface RateLimitInfo {
  status: string;
  resetsAt: number;
  rateLimitType: string;
  percentUsed?: number;
}

interface ContextUsage {
  contextBlockTokens: number;
  historyTokens: number;
  totalTokens: number;
  maxTokens: number;
}

interface UsageMetersProps {
  rateLimit: RateLimitInfo | null;
  contextUsage: ContextUsage | null;
}

function formatTimeUntil(timestamp: number): string {
  const now = Date.now();
  const diff = timestamp * 1000 - now;
  if (diff <= 0) return "now";
  const hours = Math.floor(diff / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function MiniBar({
  label,
  percent,
  sublabel,
  color,
}: {
  label: string;
  percent: number;
  sublabel: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2" title={`${label}: ${Math.round(percent)}% — ${sublabel}`}>
      <span className="text-xs text-stone-600 w-14 text-right shrink-0">
        {label}
      </span>
      <div className="w-16 h-1.5 bg-stone-800 rounded overflow-hidden">
        <div
          className={`h-full rounded transition-all ${color}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <span className="text-xs text-stone-700 tabular-nums">
        {Math.round(percent)}%
      </span>
    </div>
  );
}

export default function UsageMeters({
  rateLimit,
  contextUsage,
}: UsageMetersProps) {
  if (!rateLimit && !contextUsage) return null;

  return (
    <div className="flex gap-4 items-center">
      {rateLimit && (
        <MiniBar
          label="plan"
          percent={rateLimit.percentUsed ?? 0}
          sublabel={`resets ${formatTimeUntil(rateLimit.resetsAt)}`}
          color={
            (rateLimit.percentUsed ?? 0) > 80
              ? "bg-red-500"
              : (rateLimit.percentUsed ?? 0) > 50
                ? "bg-amber-500"
                : "bg-blue-500"
          }
        />
      )}
      {contextUsage && (
        <MiniBar
          label="ctx"
          percent={(contextUsage.totalTokens / contextUsage.maxTokens) * 100}
          sublabel={`${(contextUsage.totalTokens / 1000).toFixed(0)}k / ${(contextUsage.maxTokens / 1000).toFixed(0)}k tokens`}
          color={
            contextUsage.totalTokens / contextUsage.maxTokens > 0.8
              ? "bg-red-500"
              : contextUsage.totalTokens / contextUsage.maxTokens > 0.5
                ? "bg-amber-500"
                : "bg-emerald-500"
          }
        />
      )}
    </div>
  );
}
