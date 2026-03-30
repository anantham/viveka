"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface VaultMatch {
  relativePath: string;
  title: string;
  matchedTerm: string;
  excerpts: string[];
  fullPath: string;
  charCount: number;
}

interface RetrievePanelProps {
  /** The current text to scan for references */
  text: string;
  /** Called when user wants to add a note to context */
  onAddToContext: (name: string, content: string) => void;
  /** Already loaded note paths (to avoid showing duplicates) */
  loadedPaths?: Set<string>;
}

export default function RetrievePanel({
  text,
  onAddToContext,
  loadedPaths = new Set(),
}: RetrievePanelProps) {
  const [matches, setMatches] = useState<VaultMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingNote, setLoadingNote] = useState<string | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced search — triggers 1s after text stops changing
  useEffect(() => {
    if (!text.trim() || text.trim().length < 10) {
      setMatches([]);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/retrieve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        const data = await res.json();
        setMatches(data.matches || []);
      } catch {
        // Silently fail
      } finally {
        setLoading(false);
      }
    }, 1000);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [text]);

  const handleLoadNote = useCallback(
    async (match: VaultMatch) => {
      setLoadingNote(match.fullPath);
      try {
        const res = await fetch("/api/retrieve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: match.fullPath }),
        });
        const data = await res.json();
        if (data.content) {
          onAddToContext(match.title, data.content);
        }
      } catch (err) {
        console.error("Failed to load note:", err);
      } finally {
        setLoadingNote(null);
      }
    },
    [onAddToContext]
  );

  const filteredMatches = matches.filter((m) => !loadedPaths.has(m.fullPath));

  if (filteredMatches.length === 0 && !loading) return null;

  return (
    <div className="border-t border-stone-800/30 px-6 py-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] uppercase tracking-wider text-stone-600">
          vault references
        </span>
        {loading && (
          <span className="text-[10px] text-stone-700 animate-pulse">
            scanning...
          </span>
        )}
      </div>

      <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
        {filteredMatches.map((match) => (
          <div
            key={match.fullPath}
            className="flex items-start gap-2 group"
          >
            <button
              onClick={() => handleLoadNote(match)}
              disabled={loadingNote === match.fullPath}
              className="shrink-0 text-xs text-emerald-700 hover:text-emerald-400 disabled:text-stone-600 transition-colors mt-0.5"
            >
              {loadingNote === match.fullPath ? "..." : "+"}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-stone-400 truncate">
                  {match.title}
                </span>
                <span className="text-[10px] text-stone-700 shrink-0">
                  via &ldquo;{match.matchedTerm}&rdquo;
                </span>
                <span className="text-[10px] text-stone-800 shrink-0">
                  {match.charCount > 4000
                    ? `${(match.charCount / 1000).toFixed(0)}k chars`
                    : `${match.charCount} chars`}
                </span>
              </div>
              {match.excerpts.length > 0 && (
                <p className="text-[10px] text-stone-700 truncate mt-0.5">
                  {match.excerpts[0]}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
