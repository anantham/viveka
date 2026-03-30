"use client";

interface GhostNodeProps {
  position: { x: number; y: number };
  nodeWidth: number;
  onGenerate: () => void;
  isGenerating: boolean;
}

export default function GhostNode({
  position,
  nodeWidth,
  onGenerate,
  isGenerating,
}: GhostNodeProps) {
  return (
    <div
      className="absolute"
      style={{
        left: position.x,
        top: position.y,
        width: nodeWidth,
      }}
    >
      <button
        onClick={onGenerate}
        disabled={isGenerating}
        className={`w-full rounded-xl border-2 border-dashed px-4 py-4 text-sm transition-all ${
          isGenerating
            ? "border-amber-700/40 text-amber-600/60 animate-pulse cursor-wait"
            : "border-stone-700/50 text-stone-600 hover:border-stone-500 hover:text-stone-400 hover:bg-stone-800/30 cursor-pointer"
        }`}
      >
        {isGenerating ? "generating..." : "+ generate next"}
      </button>
    </div>
  );
}
