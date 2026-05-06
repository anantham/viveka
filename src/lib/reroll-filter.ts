/**
 * Filter LLM-returned reroll alternatives.
 *
 * The model sometimes ignores the "must not contain original word"
 * constraint and returns "intentional friction" as an alternative for
 * "friction". Word-boundary regex (case-insensitive) drops those.
 * Also strips empty strings, the original itself, and dedupes.
 */
export function filterRerollAlternatives(
  raw: unknown,
  selectedText: string,
): string[] {
  if (!Array.isArray(raw)) return [];

  const escaped = selectedText.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const originalWordRe = new RegExp(`\\b${escaped}\\b`, "i");

  return Array.from(
    new Set(
      raw
        .filter((a): a is string => typeof a === "string")
        .map((a) => a.trim())
        .filter((a) => {
          if (a.length === 0) return false;
          if (a === selectedText) return false;
          if (originalWordRe.test(a)) return false;
          return true;
        }),
    ),
  );
}
