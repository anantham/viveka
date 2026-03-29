"use client";

import { useEffect, useState } from "react";
import { Session } from "@/lib/types";

export default function HistoryPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [importPath, setImportPath] = useState("");
  const [importFilter, setImportFilter] = useState("");
  const [importLimit, setImportLimit] = useState(50);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);

  const fetchSessions = async () => {
    try {
      const res = await fetch("/api/sessions");
      const data = await res.json();
      setSessions(data);
    } catch (err) {
      console.error("Failed to fetch sessions:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  const handleImport = async () => {
    if (!importPath.trim()) return;
    setImporting(true);
    setImportResult(null);

    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: importPath.trim(),
          limit: importLimit,
          filter: importFilter.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setImportResult(`Error: ${data.error}`);
      } else {
        setImportResult(
          `Imported ${data.imported} conversations (${data.skipped} skipped)`
        );
        fetchSessions();
      }
    } catch (err) {
      setImportResult(`Failed: ${err}`);
    } finally {
      setImporting(false);
    }
  };

  // Compute session stats
  const totalExchanges = sessions.reduce(
    (sum, s) => sum + s.exchanges.length,
    0
  );
  const completed = sessions.filter((s) => s.status === "completed").length;
  const withPatterns = sessions.filter((s) =>
    s.exchanges.some(
      (e) =>
        e.heuristicFlags.anthropomorphicLevel >= 2 ||
        e.heuristicFlags.abstractionEscalation ||
        e.heuristicFlags.loopSimilarity > 0.7
    )
  ).length;

  return (
    <main className="min-h-screen p-8 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-sm font-medium text-stone-400 uppercase tracking-wider">
          Session History
        </h1>
        <div className="flex gap-3">
          <button
            onClick={() => setShowImport(!showImport)}
            className="text-xs text-stone-600 hover:text-stone-400 border border-stone-700 px-2 py-1 rounded"
          >
            {showImport ? "Hide import" : "Import"}
          </button>
          <a
            href="/"
            className="text-xs text-stone-600 hover:text-stone-400"
          >
            New Session
          </a>
        </div>
      </div>

      {/* Stats bar */}
      {sessions.length > 0 && (
        <div className="flex gap-6 mb-6 text-xs text-stone-600">
          <span>{sessions.length} sessions</span>
          <span>{totalExchanges} total exchanges</span>
          <span>{completed} completed</span>
          <span>{withPatterns} with pattern flags</span>
        </div>
      )}

      {/* Import panel */}
      {showImport && (
        <div className="border border-stone-700 rounded p-4 mb-6 space-y-3 bg-stone-900/50">
          <h2 className="text-xs text-stone-400 uppercase tracking-wider">
            Import Claude.ai conversations
          </h2>
          <div className="space-y-2">
            <input
              type="text"
              value={importPath}
              onChange={(e) => setImportPath(e.target.value)}
              placeholder="Path to backup dir or conversations.json"
              className="w-full bg-stone-800 border border-stone-600 rounded px-3 py-1.5 text-xs text-stone-200 placeholder:text-stone-600 focus:outline-none focus:border-stone-500"
            />
            <div className="flex gap-2">
              <input
                type="text"
                value={importFilter}
                onChange={(e) => setImportFilter(e.target.value)}
                placeholder="Filter by name (optional)"
                className="flex-1 bg-stone-800 border border-stone-600 rounded px-3 py-1.5 text-xs text-stone-200 placeholder:text-stone-600 focus:outline-none focus:border-stone-500"
              />
              <div className="flex items-center gap-1">
                <label className="text-xs text-stone-500">Limit:</label>
                <input
                  type="number"
                  value={importLimit}
                  onChange={(e) =>
                    setImportLimit(parseInt(e.target.value) || 50)
                  }
                  className="w-16 bg-stone-800 border border-stone-600 rounded px-2 py-1.5 text-xs text-stone-200 focus:outline-none focus:border-stone-500"
                />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleImport}
              disabled={importing || !importPath.trim()}
              className="px-3 py-1.5 text-xs bg-stone-800 border border-stone-600 rounded text-stone-300 hover:bg-stone-700 disabled:opacity-50"
            >
              {importing ? "Importing..." : "Import"}
            </button>
            {importResult && (
              <span
                className={`text-xs ${importResult.startsWith("Error") || importResult.startsWith("Failed") ? "text-red-400" : "text-emerald-400"}`}
              >
                {importResult}
              </span>
            )}
          </div>
        </div>
      )}

      {loading && (
        <p className="text-sm text-stone-600 animate-pulse">
          Loading sessions...
        </p>
      )}

      {!loading && sessions.length === 0 && (
        <p className="text-sm text-stone-600">
          No sessions found. Create one or import from a Claude.ai backup.
        </p>
      )}

      <div className="space-y-2">
        {sessions.map((s) => {
          // Compute pattern summary
          const patterns: string[] = [];
          const maxAnthro = Math.max(
            0,
            ...s.exchanges.map((e) => e.heuristicFlags.anthropomorphicLevel)
          );
          if (maxAnthro >= 2) patterns.push(`anthro L${maxAnthro}`);

          const escalations = s.exchanges.filter(
            (e) => e.heuristicFlags.abstractionEscalation
          ).length;
          if (escalations > 0) patterns.push(`${escalations} escalation${escalations > 1 ? "s" : ""}`);

          const loops = s.exchanges.filter(
            (e) => e.heuristicFlags.loopSimilarity > 0.7
          ).length;
          if (loops > 0) patterns.push(`${loops} loop${loops > 1 ? "s" : ""}`);

          return (
            <div
              key={s.id}
              className="border border-stone-800 rounded p-3 hover:border-stone-700 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm text-stone-300 leading-tight">
                  {s.intent}
                </span>
                <span
                  className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${
                    s.status === "completed"
                      ? "bg-emerald-950 text-emerald-400"
                      : s.status === "budget_exhausted"
                        ? "bg-red-950 text-red-400"
                        : s.status === "abandoned"
                          ? "bg-stone-800 text-stone-500"
                          : "bg-blue-950 text-blue-400"
                  }`}
                >
                  {s.status}
                </span>
              </div>
              <div className="flex gap-3 mt-1 text-xs text-stone-600 flex-wrap">
                <span>{s.mode}</span>
                <span>
                  {s.exchanges.length}/{s.budget} exchanges
                </span>
                <span>
                  {new Date(s.createdAt).toLocaleDateString()}{" "}
                  {new Date(s.createdAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                {patterns.length > 0 && (
                  <span className="text-amber-600">
                    {patterns.join(", ")}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
