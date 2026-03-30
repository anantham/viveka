"use client";

import { useState, useEffect, useRef } from "react";

type LLMBackend = "claude" | "ollama" | "lmstudio" | "openrouter";

interface LLMConfig {
  backend: LLMBackend;
  ollama: { baseUrl: string; model: string };
  lmstudio: { baseUrl: string; model: string };
  openrouter: { apiKey: string; model: string };
}

const BACKEND_LABELS: Record<LLMBackend, string> = {
  claude: "Claude Code",
  ollama: "Ollama",
  lmstudio: "LM Studio",
  openrouter: "OpenRouter",
};

export default function LLMSettings() {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<LLMConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && !config) {
      fetch("/api/llm-config")
        .then((r) => r.json())
        .then(setConfig)
        .catch(() => setStatus("Failed to load config"));
    }
  }, [open, config]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const save = async (updates: Partial<LLMConfig>) => {
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/llm-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (data.ok) {
        setStatus(`Switched to ${BACKEND_LABELS[data.backend as LLMBackend]}`);
        setConfig((prev) => (prev ? { ...prev, ...updates } : prev));
      }
    } catch {
      setStatus("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`text-xs px-1.5 py-0.5 rounded border transition-colors ${
          open
            ? "border-stone-500 text-stone-300"
            : "border-stone-700 text-stone-600 hover:text-stone-400"
        }`}
        title="LLM backend settings"
      >
        {/* Gear icon */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {open && config && (
        <div className="absolute right-0 top-8 z-50 w-72 bg-stone-900 border border-stone-700 rounded-lg shadow-xl p-3 space-y-3">
          <div className="text-xs text-stone-400 font-medium uppercase tracking-wider">
            LLM Backend
          </div>

          {/* Backend selector */}
          <div className="grid grid-cols-2 gap-1">
            {(["claude", "ollama", "lmstudio", "openrouter"] as const).map((b) => (
              <button
                key={b}
                onClick={() => save({ backend: b })}
                disabled={saving}
                className={`text-xs px-2 py-1.5 rounded border transition-colors ${
                  config.backend === b
                    ? "bg-stone-700 border-stone-500 text-stone-200"
                    : "border-stone-700 text-stone-500 hover:text-stone-400"
                }`}
              >
                {BACKEND_LABELS[b]}
              </button>
            ))}
          </div>

          {/* Ollama settings */}
          {config.backend === "ollama" && (
            <div className="space-y-2 pt-1">
              <label className="block">
                <span className="text-xs text-stone-500">Model</span>
                <input
                  type="text"
                  value={config.ollama.model}
                  onChange={(e) =>
                    setConfig({ ...config, ollama: { ...config.ollama, model: e.target.value } })
                  }
                  onBlur={() => save({ ollama: config.ollama })}
                  className="w-full mt-0.5 bg-stone-800 border border-stone-600 rounded px-2 py-1 text-xs text-stone-200 focus:outline-none focus:border-stone-500"
                />
              </label>
              <label className="block">
                <span className="text-xs text-stone-500">Base URL</span>
                <input
                  type="text"
                  value={config.ollama.baseUrl}
                  onChange={(e) =>
                    setConfig({ ...config, ollama: { ...config.ollama, baseUrl: e.target.value } })
                  }
                  onBlur={() => save({ ollama: config.ollama })}
                  className="w-full mt-0.5 bg-stone-800 border border-stone-600 rounded px-2 py-1 text-xs text-stone-200 focus:outline-none focus:border-stone-500"
                />
              </label>
            </div>
          )}

          {/* LM Studio settings */}
          {config.backend === "lmstudio" && (
            <div className="space-y-2 pt-1">
              <label className="block">
                <span className="text-xs text-stone-500">Model</span>
                <input
                  type="text"
                  value={config.lmstudio.model}
                  onChange={(e) =>
                    setConfig({ ...config, lmstudio: { ...config.lmstudio, model: e.target.value } })
                  }
                  onBlur={() => save({ lmstudio: config.lmstudio })}
                  className="w-full mt-0.5 bg-stone-800 border border-stone-600 rounded px-2 py-1 text-xs text-stone-200 focus:outline-none focus:border-stone-500"
                />
              </label>
              <label className="block">
                <span className="text-xs text-stone-500">Base URL</span>
                <input
                  type="text"
                  value={config.lmstudio.baseUrl}
                  onChange={(e) =>
                    setConfig({ ...config, lmstudio: { ...config.lmstudio, baseUrl: e.target.value } })
                  }
                  onBlur={() => save({ lmstudio: config.lmstudio })}
                  placeholder="http://100.x.x.x:1234/v1"
                  className="w-full mt-0.5 bg-stone-800 border border-stone-600 rounded px-2 py-1 text-xs text-stone-200 placeholder:text-stone-700 focus:outline-none focus:border-stone-500"
                />
              </label>
            </div>
          )}

          {/* OpenRouter settings */}
          {config.backend === "openrouter" && (
            <div className="space-y-2 pt-1">
              <label className="block">
                <span className="text-xs text-stone-500">Model</span>
                <input
                  type="text"
                  value={config.openrouter.model}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      openrouter: { ...config.openrouter, model: e.target.value },
                    })
                  }
                  onBlur={() => save({ openrouter: config.openrouter })}
                  className="w-full mt-0.5 bg-stone-800 border border-stone-600 rounded px-2 py-1 text-xs text-stone-200 focus:outline-none focus:border-stone-500"
                />
              </label>
              <label className="block">
                <span className="text-xs text-stone-500">API Key</span>
                <input
                  type="password"
                  value={config.openrouter.apiKey}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      openrouter: { ...config.openrouter, apiKey: e.target.value },
                    })
                  }
                  onBlur={() => save({ openrouter: config.openrouter })}
                  placeholder="sk-or-..."
                  className="w-full mt-0.5 bg-stone-800 border border-stone-600 rounded px-2 py-1 text-xs text-stone-200 placeholder:text-stone-700 focus:outline-none focus:border-stone-500"
                />
              </label>
            </div>
          )}

          {/* Status */}
          {status && (
            <div className="text-xs text-stone-500 pt-1">{status}</div>
          )}
        </div>
      )}
    </div>
  );
}
