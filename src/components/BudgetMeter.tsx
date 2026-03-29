"use client";

interface BudgetMeterProps {
  used: number;
  total: number;
}

export default function BudgetMeter({ used, total }: BudgetMeterProps) {
  const ratio = used / total;
  const segments = Array.from({ length: total }, (_, i) => i < used);

  const getColor = (filled: boolean, index: number) => {
    if (!filled) return "bg-stone-800";
    const r = index / total;
    if (r < 0.5) return "bg-emerald-500";
    if (r < 0.75) return "bg-amber-500";
    return "bg-red-500";
  };

  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-stone-500 mr-2">
        {used}/{total}
      </span>
      <div className="flex gap-0.5">
        {segments.map((filled, i) => (
          <div
            key={i}
            className={`w-3 h-3 rounded-sm transition-colors ${getColor(filled, i)} ${
              ratio >= 0.75 && filled && i === used - 1 ? "animate-pulse" : ""
            }`}
          />
        ))}
      </div>
    </div>
  );
}
