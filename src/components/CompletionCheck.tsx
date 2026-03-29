"use client";

interface CompletionCheckProps {
  completionCondition: string;
  onComplete: () => void;
  onNotYet: () => void;
  onRevise: () => void;
}

export default function CompletionCheck({
  completionCondition,
  onComplete,
  onNotYet,
  onRevise,
}: CompletionCheckProps) {
  return (
    <div className="border border-stone-700 bg-stone-900 rounded p-4 mt-4">
      <p className="text-sm text-stone-400 mb-2">
        Has your stated completion condition been met?
      </p>
      <p className="text-sm text-stone-300 mb-3 italic">
        &ldquo;{completionCondition}&rdquo;
      </p>
      <div className="flex gap-2">
        <button
          onClick={onComplete}
          className="px-3 py-1.5 text-xs bg-emerald-900 text-emerald-300 border border-emerald-700 rounded hover:bg-emerald-800 transition-colors"
        >
          Yes — End Session
        </button>
        <button
          onClick={onNotYet}
          className="px-3 py-1.5 text-xs bg-stone-800 text-stone-300 border border-stone-600 rounded hover:bg-stone-700 transition-colors"
        >
          Not yet
        </button>
        <button
          onClick={onRevise}
          className="px-3 py-1.5 text-xs bg-stone-800 text-stone-400 border border-stone-600 rounded hover:bg-stone-700 transition-colors"
        >
          Revise condition
        </button>
      </div>
    </div>
  );
}
