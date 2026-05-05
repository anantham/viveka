"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SessionForm from "@/components/SessionForm";
import { SessionMode } from "@/lib/types";
import LLMSettings from "@/components/LLMSettings";

export default function Home() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interfaceMode, setInterfaceMode] = useState<"loom" | "dump">("loom");

  const handleSubmit = async (data: {
    intent: string;
    completionCondition: string;
    mode: SessionMode;
    budget: number;
  }) => {
    setLoading(true);
    setError(null);

    try {
      if (interfaceMode === "dump") {
        // Create a freeform dump — no form needed, just go
        const res = await fetch("/api/dump/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: data.intent || undefined }),
        });
        if (!res.ok) {
          const err = await res.json();
          setError(err.error || "Failed to create dump");
          return;
        }
        const tree = await res.json();
        router.push(`/dump/${tree.id}`);
      } else {
        // Create a tree-based session (loom is the only non-dump path)
        const res = await fetch("/api/tree/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!res.ok) {
          const err = await res.json();
          setError(err.error || "Failed to create tree");
          return;
        }
        const tree = await res.json();
        router.push(`/loom/${tree.id}`);
      }
    } catch (err) {
      setError("Failed to create session");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      {/* Settings gear — top right */}
      <div className="fixed top-4 right-4">
        <LLMSettings />
      </div>
      <div className="mb-12 text-center">
        <h1 className="text-2xl font-medium text-stone-300 tracking-widest mb-2">
          VIVEKA
        </h1>
        <p className="text-sm text-stone-600">
          Attentional scaffolding for human-AI interaction
        </p>
      </div>

      {/* Interface mode toggle */}
      <div className="flex gap-4 mb-8">
        {(["dump", "loom"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setInterfaceMode(m)}
            className={`px-6 py-3 text-base rounded-lg border transition-colors ${
              interfaceMode === m
                ? "bg-stone-700 border-stone-500 text-stone-200"
                : "bg-stone-800 border-stone-700 text-stone-500 hover:text-stone-400"
            }`}
          >
            {m === "dump" ? "Dump (freeform)" : "LOOM (tree)"}
          </button>
        ))}
      </div>

      {interfaceMode === "dump" ? (
        <div className="max-w-2xl w-full">
          <div className="border border-stone-700 rounded-lg p-8 space-y-6 bg-stone-900/50">
            <h2 className="text-base font-medium text-stone-400 uppercase tracking-wider">
              Freeform Dump
            </h2>
            <p className="text-sm text-stone-600">
              No questions. No structure. Just write. Auto-saves as you go.
            </p>
            <input
              type="text"
              placeholder="Optional title (e.g. 'bath insight about standing waves')"
              className="w-full bg-stone-800 border border-stone-600 rounded-lg px-4 py-3 text-base text-stone-200 placeholder:text-stone-600 focus:outline-none focus:border-stone-500"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleSubmit({
                    intent: (e.target as HTMLInputElement).value,
                    completionCondition: "thought externalized",
                    mode: "reflective",
                    budget: 999,
                  });
                }
              }}
            />
            <button
              onClick={() =>
                handleSubmit({
                  intent: "",
                  completionCondition: "thought externalized",
                  mode: "reflective",
                  budget: 999,
                })
              }
              disabled={loading}
              className="w-full py-3 text-base bg-stone-800 border border-stone-600 rounded-lg text-stone-300 hover:bg-stone-700 transition-colors disabled:opacity-50"
            >
              {loading ? "Creating..." : "Begin writing"}
            </button>
          </div>
        </div>
      ) : (
        <SessionForm onSubmit={handleSubmit} loading={loading} />
      )}

      {error && (
        <p className="mt-4 text-xs text-red-400">{error}</p>
      )}

      <a
        href="/history"
        className="mt-8 text-xs text-stone-700 hover:text-stone-500"
      >
        Past sessions
      </a>
    </main>
  );
}
