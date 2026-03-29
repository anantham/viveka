"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SessionForm from "@/components/SessionForm";
import { SessionMode } from "@/lib/types";

export default function Home() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interfaceMode, setInterfaceMode] = useState<"linear" | "loom">("loom");

  const handleSubmit = async (data: {
    intent: string;
    completionCondition: string;
    mode: SessionMode;
    budget: number;
  }) => {
    setLoading(true);
    setError(null);

    try {
      if (interfaceMode === "loom") {
        // Create a tree-based session
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
      } else {
        // Create a linear session
        const res = await fetch("/api/session/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!res.ok) {
          const err = await res.json();
          setError(err.error || "Failed to create session");
          return;
        }
        const session = await res.json();
        sessionStorage.setItem(
          `viveka-session-${session.id}`,
          JSON.stringify(session)
        );
        router.push(`/session/${session.id}`);
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
      <div className="mb-8 text-center">
        <h1 className="text-lg font-medium text-stone-400 tracking-wider mb-1">
          VIVEKA
        </h1>
        <p className="text-xs text-stone-600">
          Attentional scaffolding for human-AI interaction
        </p>
      </div>

      {/* Interface mode toggle */}
      <div className="flex gap-2 mb-4">
        {(["loom", "linear"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setInterfaceMode(m)}
            className={`px-3 py-1 text-xs rounded border transition-colors ${
              interfaceMode === m
                ? "bg-stone-700 border-stone-500 text-stone-200"
                : "bg-stone-800 border-stone-700 text-stone-500 hover:text-stone-400"
            }`}
          >
            {m === "loom" ? "LOOM (tree)" : "Linear (chat)"}
          </button>
        ))}
      </div>

      <SessionForm onSubmit={handleSubmit} loading={loading} />

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
