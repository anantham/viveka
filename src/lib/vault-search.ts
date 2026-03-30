import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, basename } from "path";

export interface VaultMatch {
  /** File path relative to vault root */
  relativePath: string;
  /** Note title (filename without .md) */
  title: string;
  /** The matching term found in the dump text */
  matchedTerm: string;
  /** Lines from the note containing the term (for preview) */
  excerpts: string[];
  /** Full file path */
  fullPath: string;
  /** File size in chars */
  charCount: number;
}

/**
 * Build an index of note titles and their paths.
 * Walks the vault directory recursively.
 */
function walkVault(dir: string, files: string[] = []): string[] {
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (entry.startsWith(".") || entry === "node_modules") continue;
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          walkVault(fullPath, files);
        } else if (entry.endsWith(".md")) {
          files.push(fullPath);
        }
      } catch {
        // Skip files we can't stat
      }
    }
  } catch {
    // Skip directories we can't read
  }
  return files;
}

/**
 * Extract significant terms from text.
 * Looks for: multi-word proper nouns, technical terms, words with special casing.
 * Filters out common English words.
 */
const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "shall",
  "should", "may", "might", "must", "can", "could", "and", "but", "or",
  "nor", "not", "so", "yet", "for", "to", "of", "in", "on", "at", "by",
  "with", "from", "up", "about", "into", "through", "during", "before",
  "after", "above", "below", "between", "out", "off", "over", "under",
  "again", "further", "then", "once", "here", "there", "when", "where",
  "why", "how", "all", "both", "each", "few", "more", "most", "other",
  "some", "such", "no", "only", "own", "same", "than", "too", "very",
  "just", "because", "if", "while", "that", "this", "these", "those",
  "what", "which", "who", "whom", "its", "it", "i", "me", "my", "we",
  "our", "you", "your", "he", "him", "his", "she", "her", "they", "them",
  "their", "like", "also", "really", "want", "need", "think", "know",
  "feel", "make", "get", "go", "come", "see", "look", "find", "give",
  "tell", "say", "take", "thing", "something", "way", "much", "many",
]);

export function extractTerms(text: string): string[] {
  const terms = new Set<string>();

  // Extract words that might be significant (3+ chars, not stop words)
  const words = text.split(/\s+/).map((w) => w.replace(/[^a-zA-Z0-9'-]/g, "")).filter(Boolean);
  for (const word of words) {
    if (word.length < 3) continue;
    if (STOP_WORDS.has(word.toLowerCase())) continue;
    terms.add(word.toLowerCase());
  }

  return Array.from(terms);
}

/**
 * Search the vault for notes matching terms from the input text.
 * Returns notes whose title or content contains the search terms.
 */
export function searchVault(
  vaultPath: string,
  inputText: string,
  maxResults: number = 20
): VaultMatch[] {
  const terms = extractTerms(inputText);
  if (terms.length === 0) return [];

  const allFiles = walkVault(vaultPath);
  const matches: VaultMatch[] = [];
  const seen = new Set<string>();

  // Phase 1: Title matches (strongest signal)
  for (const filePath of allFiles) {
    const title = basename(filePath, ".md").toLowerCase();
    for (const term of terms) {
      if (title.includes(term) && term.length >= 4) {
        if (seen.has(filePath)) continue;
        seen.add(filePath);
        try {
          const content = readFileSync(filePath, "utf-8");
          matches.push({
            relativePath: relative(vaultPath, filePath),
            title: basename(filePath, ".md"),
            matchedTerm: term,
            excerpts: extractExcerpts(content, term, 2),
            fullPath: filePath,
            charCount: content.length,
          });
        } catch {
          // Skip unreadable files
        }
      }
    }
    if (matches.length >= maxResults) break;
  }

  // Phase 2: Content matches (for specific/rare terms only)
  if (matches.length < maxResults) {
    // Only search content for terms that are likely private vocabulary (longer, unusual)
    const rareTerms = terms.filter((t) => t.length >= 5);

    for (const filePath of allFiles) {
      if (seen.has(filePath)) continue;
      if (matches.length >= maxResults) break;

      try {
        const content = readFileSync(filePath, "utf-8");
        const lower = content.toLowerCase();
        for (const term of rareTerms) {
          if (lower.includes(term)) {
            seen.add(filePath);
            matches.push({
              relativePath: relative(vaultPath, filePath),
              title: basename(filePath, ".md"),
              matchedTerm: term,
              excerpts: extractExcerpts(content, term, 2),
              fullPath: filePath,
              charCount: content.length,
            });
            break;
          }
        }
      } catch {
        // Skip
      }
    }
  }

  return matches;
}

function extractExcerpts(
  content: string,
  term: string,
  maxExcerpts: number
): string[] {
  const lines = content.split("\n");
  const excerpts: string[] = [];
  const termLower = term.toLowerCase();

  for (const line of lines) {
    if (excerpts.length >= maxExcerpts) break;
    if (line.toLowerCase().includes(termLower) && line.trim().length > 10) {
      excerpts.push(line.trim().slice(0, 200));
    }
  }

  return excerpts;
}
