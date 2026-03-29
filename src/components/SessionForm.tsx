"use client";

import { useState } from "react";
import { SessionMode, MODE_DEFAULTS } from "@/lib/types";

interface SessionFormProps {
  onSubmit: (data: {
    intent: string;
    completionCondition: string;
    mode: SessionMode;
    budget: number;
  }) => void;
  loading?: boolean;
}

export default function SessionForm({ onSubmit, loading }: SessionFormProps) {
  const [intent, setIntent] = useState("");
  const [completionCondition, setCompletionCondition] = useState("");
  const [mode, setMode] = useState<SessionMode>("instrumental");
  const [budget, setBudget] = useState(MODE_DEFAULTS.instrumental.budget);

  const handleModeChange = (newMode: SessionMode) => {
    setMode(newMode);
    setBudget(MODE_DEFAULTS[newMode].budget);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!intent.trim() || !completionCondition.trim()) return;
    onSubmit({ intent: intent.trim(), completionCondition: completionCondition.trim(), mode, budget });
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-lg w-full space-y-6">
      <div className="border border-stone-700 rounded-lg p-6 space-y-5 bg-stone-900/50">
        <h2 className="text-sm font-medium text-stone-400 uppercase tracking-wider">
          New Session
        </h2>

        <div className="space-y-2">
          <label className="block text-sm text-stone-400">
            What is the concrete output?
          </label>
          <input
            type="text"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            placeholder="Debug auth middleware, write migration script, etc."
            className="w-full bg-stone-800 border border-stone-600 rounded px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:border-stone-500"
            required
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm text-stone-400">
            What signals completion?
          </label>
          <input
            type="text"
            value={completionCondition}
            onChange={(e) => setCompletionCondition(e.target.value)}
            placeholder="Auth tests pass, migration runs without errors, etc."
            className="w-full bg-stone-800 border border-stone-600 rounded px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:border-stone-500"
            required
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm text-stone-400">Mode</label>
          <div className="flex gap-3">
            {(["instrumental", "exploratory", "reflective"] as const).map(
              (m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => handleModeChange(m)}
                  className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                    mode === m
                      ? "bg-stone-700 border-stone-500 text-stone-200"
                      : "bg-stone-800 border-stone-700 text-stone-500 hover:text-stone-400"
                  }`}
                >
                  {m}
                </button>
              )
            )}
          </div>
          <p className="text-xs text-stone-600">
            {mode === "instrumental" &&
              "Tight limits. Tangent warnings at exchange 3."}
            {mode === "exploratory" &&
              "Moderate room. Abstraction tracking from exchange 4."}
            {mode === "reflective" &&
              "Aggressive limits. Hard time-limit. Body-check prompts."}
          </p>
        </div>

        <div className="space-y-2">
          <label className="block text-sm text-stone-400">
            Budget: {budget} exchanges
          </label>
          <input
            type="range"
            min={1}
            max={20}
            value={budget}
            onChange={(e) => setBudget(parseInt(e.target.value))}
            className="w-full accent-stone-500"
          />
        </div>

        <button
          type="submit"
          disabled={loading || !intent.trim() || !completionCondition.trim()}
          className="w-full py-2 text-sm bg-stone-800 border border-stone-600 rounded text-stone-300 hover:bg-stone-700 hover:text-stone-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Creating..." : "Begin Session"}
        </button>
      </div>
    </form>
  );
}
