"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { SessionMode, MODE_DEFAULTS } from "@/lib/types";

interface IntentTemplate {
  intent: string;
  completionCondition: string;
  mode: SessionMode;
  frequency: number;
  category: string;
}

interface CategoryInfo {
  id: string;
  label: string;
  description: string;
  dominantMode: string;
}

interface SessionFormProps {
  onSubmit: (data: {
    intent: string;
    completionCondition: string;
    mode: SessionMode;
    budget: number;
  }) => void;
  loading?: boolean;
}

const MODE_COLORS: Record<SessionMode, string> = {
  instrumental: "bg-amber-900/60 text-amber-400 border-amber-700/50",
  exploratory: "bg-sky-900/60 text-sky-400 border-sky-700/50",
  reflective: "bg-violet-900/60 text-violet-400 border-violet-700/50",
};

/** Highlight [placeholder] tokens inside template intent text */
function renderIntentWithPlaceholders(text: string) {
  const parts = text.split(/(\[[^\]]+\])/g);
  return parts.map((part, i) =>
    part.startsWith("[") && part.endsWith("]") ? (
      <span key={i} className="text-teal-400">{part}</span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

/** Simple fuzzy match: all query words must appear somewhere in the target (case-insensitive) */
function fuzzyMatch(query: string, target: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = target.toLowerCase();
  return words.every((w) => lower.includes(w));
}

/** Frequency bar rendered as a subtle inline indicator */
function FrequencyIndicator({ frequency, maxFrequency }: { frequency: number; maxFrequency: number }) {
  const width = Math.max(8, (frequency / maxFrequency) * 100);
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <div className="h-1 rounded-full bg-stone-700 w-12 flex-shrink-0 overflow-hidden">
        <div
          className="h-full rounded-full bg-stone-500"
          style={{ width: `${width}%` }}
        />
      </div>
      <span className="text-[10px] text-stone-600 flex-shrink-0">{frequency}x</span>
    </div>
  );
}

export default function SessionForm({ onSubmit, loading }: SessionFormProps) {
  const [intent, setIntent] = useState("");
  const [completionCondition, setCompletionCondition] = useState("");
  const [mode, setMode] = useState<SessionMode>("instrumental");
  const [budget, setBudget] = useState(MODE_DEFAULTS.instrumental.budget);

  const [templates, setTemplates] = useState<IntentTemplate[]>([]);
  const [categories, setCategories] = useState<CategoryInfo[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch templates on mount
  useEffect(() => {
    fetch("/api/templates")
      .then((r) => r.json())
      .then((data) => {
        setTemplates(data.templates ?? []);
        setCategories(data.categories ?? []);
      })
      .catch(() => {
        // Silently fail — templates are a suggestion feature, not critical
      });
  }, []);

  const maxFrequency = useMemo(
    () => Math.max(1, ...templates.map((t) => t.frequency)),
    [templates]
  );

  // Build a category label lookup
  const categoryLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of categories) {
      map[c.id] = c.label;
    }
    return map;
  }, [categories]);

  // Filter / group templates based on current input
  const visibleTemplates = useMemo(() => {
    if (!templates.length) return [];

    const query = intent.trim();

    if (query.length === 0) {
      // Show all templates grouped by category, sorted by frequency within each group
      return templates;
    }

    // Filter by fuzzy match
    return templates.filter((t) => fuzzyMatch(query, t.intent));
  }, [intent, templates]);

  // Group templates by category for display
  const groupedTemplates = useMemo(() => {
    const groups: { category: string; label: string; templates: IntentTemplate[] }[] = [];
    const seen = new Set<string>();

    for (const t of visibleTemplates) {
      if (!seen.has(t.category)) {
        seen.add(t.category);
        groups.push({
          category: t.category,
          label: categoryLabels[t.category] ?? t.category,
          templates: [],
        });
      }
      groups.find((g) => g.category === t.category)!.templates.push(t);
    }

    return groups;
  }, [visibleTemplates, categoryLabels]);

  // Flat list for keyboard navigation
  const flatList = useMemo(() => visibleTemplates, [visibleTemplates]);

  const selectTemplate = useCallback(
    (template: IntentTemplate) => {
      setIntent(template.intent);
      setCompletionCondition(template.completionCondition);
      const newMode = template.mode as SessionMode;
      setMode(newMode);
      setBudget(MODE_DEFAULTS[newMode].budget);
      setShowDropdown(false);
      setHighlightedIndex(-1);
    },
    []
  );

  const handleModeChange = (newMode: SessionMode) => {
    setMode(newMode);
    setBudget(MODE_DEFAULTS[newMode].budget);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!intent.trim() || !completionCondition.trim()) return;
    onSubmit({ intent: intent.trim(), completionCondition: completionCondition.trim(), mode, budget });
  };

  const handleIntentFocus = () => {
    setShowDropdown(true);
    setHighlightedIndex(-1);
  };

  const handleIntentBlur = () => {
    // Delay blur to allow click on dropdown items to register
    blurTimeoutRef.current = setTimeout(() => {
      setShowDropdown(false);
      setHighlightedIndex(-1);
    }, 200);
  };

  const handleDropdownMouseDown = () => {
    // Prevent blur from firing when clicking inside the dropdown
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || flatList.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev < flatList.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev > 0 ? prev - 1 : flatList.length - 1
      );
    } else if (e.key === "Enter" && highlightedIndex >= 0) {
      e.preventDefault();
      selectTemplate(flatList[highlightedIndex]);
    } else if (e.key === "Escape") {
      setShowDropdown(false);
      setHighlightedIndex(-1);
    }
  };

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex < 0 || !dropdownRef.current) return;
    const items = dropdownRef.current.querySelectorAll("[data-template-item]");
    items[highlightedIndex]?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    };
  }, []);

  // Precompute a flat index for each template for keyboard navigation
  const templateFlatIndex = useMemo(() => {
    const map = new Map<string, number>();
    let idx = 0;
    for (const group of groupedTemplates) {
      for (const t of group.templates) {
        map.set(`${t.category}-${t.intent}`, idx++);
      }
    }
    return map;
  }, [groupedTemplates]);

  return (
    <form onSubmit={handleSubmit} className="max-w-lg w-full space-y-6">
      <div className="border border-stone-700 rounded-lg p-6 space-y-5 bg-stone-900/50">
        <h2 className="text-sm font-medium text-stone-400 uppercase tracking-wider">
          New Session
        </h2>

        {/* Intent field with template dropdown */}
        <div className="space-y-2 relative">
          <label className="block text-sm text-stone-400">
            What is the concrete output?
          </label>
          <input
            ref={inputRef}
            type="text"
            value={intent}
            onChange={(e) => {
              setIntent(e.target.value);
              setShowDropdown(true);
              setHighlightedIndex(-1);
            }}
            onFocus={handleIntentFocus}
            onBlur={handleIntentBlur}
            onKeyDown={handleKeyDown}
            placeholder="Debug auth middleware, write migration script, etc."
            className="w-full bg-stone-800 border border-stone-600 rounded px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:border-stone-500"
            required
            autoComplete="off"
          />

          {/* Template dropdown */}
          {showDropdown && templates.length > 0 && visibleTemplates.length > 0 && (
            <div
              ref={dropdownRef}
              onMouseDown={handleDropdownMouseDown}
              className="absolute z-50 left-0 right-0 top-full mt-1 max-h-72 overflow-y-auto rounded-lg border border-stone-700 bg-stone-900 shadow-xl shadow-black/40"
            >
              {groupedTemplates.map((group) => (
                <div key={group.category}>
                  {/* Category header */}
                  <div className="sticky top-0 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-stone-500 bg-stone-900/95 backdrop-blur-sm border-b border-stone-800">
                    {group.label}
                  </div>

                  {group.templates.map((template) => {
                    const idx = templateFlatIndex.get(`${template.category}-${template.intent}`) ?? -1;
                    const isHighlighted = idx === highlightedIndex;

                    return (
                      <button
                        key={`${template.category}-${template.intent}`}
                        type="button"
                        data-template-item
                        onClick={() => selectTemplate(template)}
                        className={`w-full text-left px-3 py-2 flex items-start gap-2 transition-colors border-b border-stone-800/50 last:border-b-0 ${
                          isHighlighted
                            ? "bg-stone-800"
                            : "hover:bg-stone-800/60"
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-stone-300 leading-snug">
                            {renderIntentWithPlaceholders(template.intent)}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span
                              className={`inline-block text-[10px] px-1.5 py-0.5 rounded border ${MODE_COLORS[template.mode]}`}
                            >
                              {template.mode}
                            </span>
                            <FrequencyIndicator
                              frequency={template.frequency}
                              maxFrequency={maxFrequency}
                            />
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))}

            </div>
          )}

          {/* No matches message */}
          {showDropdown && templates.length > 0 && intent.trim().length > 0 && visibleTemplates.length === 0 && (
            <div className="absolute z-50 left-0 right-0 top-full mt-1 rounded-lg border border-stone-700 bg-stone-900 shadow-xl shadow-black/40 px-3 py-3 text-xs text-stone-600">
              No matching templates. Type freely to define your own intent.
            </div>
          )}
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
