"use client";

import { useMemo, useState } from "react";
import type { Workspace, Fragment, Operation } from "@/lib/workspace";
import { getWorkspaceContext } from "@/lib/workspace";
import { estimateTokens, MAX_CONTEXT_TOKENS } from "@/lib/types";
import MarkdownText from "../MarkdownText";

/**
 * ChatView — the machinery x-ray.
 *
 * This isn't a redesign of canvas-as-bubbles. It's the *other* projection
 * of the same workspace: what the LLM actually sees, in what order,
 * with which prompts. Three sections:
 *
 *   1. NEXT — the assembly that would be sent if the writer generated
 *      something now (system intent + sequence + enabled context blocks
 *      + token total).
 *   2. HISTORY — chronological log of ai-generated / merge / reroll /
 *      human-typed ops, newest first. Each ai entry shows its prompt and
 *      its result fragment's current content.
 *   3. (Editing the artifact happens elsewhere — canvas, reader, tree.)
 *
 * Pure projection of Workspace. No bridge through ConversationTree.
 */

interface ChatViewProps {
  ws: Workspace;
  onFragmentClick?: (id: string) => void;
}

function shortId(id: string) {
  return id.slice(0, 8);
}

function fmtDuration(ms?: number): string {
  if (typeof ms !== "number") return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtTimestamp(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function roleOf(f: Fragment): "system" | "user" | "assistant" {
  if (f.provenance.type === "system") return "system";
  if (f.provenance.type === "ai-generated" || f.provenance.type === "merged" || f.provenance.type === "derived") {
    return "assistant";
  }
  return "user";
}

function roleColor(role: "system" | "user" | "assistant") {
  return role === "system"
    ? "text-stone-500"
    : role === "user"
      ? "text-emerald-500/80"
      : "text-blue-400/80";
}

function fragmentPreview(content: string, max = 320) {
  if (!content) return "(empty)";
  if (content.length <= max) return content;
  return content.slice(0, max).trimEnd() + "…";
}

// ---------------------------------------------------------------------------
// "NEXT" section — current assembly that would be sent
// ---------------------------------------------------------------------------

function NextAssembly({
  ws,
  onFragmentClick,
}: {
  ws: Workspace;
  onFragmentClick?: (id: string) => void;
}) {
  const context = useMemo(() => getWorkspaceContext(ws), [ws]);
  const totalTokens = useMemo(
    () => context.reduce((s, f) => s + estimateTokens(f.content), 0),
    [context],
  );
  const pct = (totalTokens / MAX_CONTEXT_TOKENS) * 100;

  return (
    <section className="border border-stone-800 rounded p-4 mb-6 bg-stone-950">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-[10px] uppercase tracking-wider text-stone-500">
          next ▸ assembly
        </h3>
        <span className="text-[10px] text-stone-600 tabular-nums">
          {(totalTokens / 1000).toFixed(1)}k / {(MAX_CONTEXT_TOKENS / 1000).toFixed(0)}k tokens
          ({pct.toFixed(1)}%)
        </span>
      </div>

      {context.length === 0 ? (
        <div className="text-xs text-stone-600 italic">empty workspace</div>
      ) : (
        <div className="space-y-2">
          {context.map((c, i) => {
            const role = roleOf(ws.fragments[c.id] ?? ({} as Fragment));
            const tokens = estimateTokens(c.content);
            return (
              <button
                key={c.id}
                onClick={() => onFragmentClick?.(c.id)}
                className="w-full text-left px-3 py-2 rounded border border-stone-800 hover:border-stone-700 hover:bg-stone-900/50 transition-colors group"
                title={`Fragment ${shortId(c.id)} · ${tokens} tokens`}
              >
                <div className="flex items-baseline gap-3 text-[10px] mb-1">
                  <span className={`uppercase tracking-wider ${roleColor(role)}`}>
                    {role}
                  </span>
                  <span className="text-stone-700 font-mono">{shortId(c.id)}</span>
                  <span className="text-stone-700 ml-auto tabular-nums">{tokens}t</span>
                </div>
                <div className="text-xs text-stone-300 leading-relaxed">
                  <MarkdownText>{fragmentPreview(c.content)}</MarkdownText>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {ws.contextBlockIds.length > 0 && (
        <div className="mt-3 pt-3 border-t border-stone-800 text-[10px] text-stone-500">
          + {ws.contextBlockIds.length} context block(s) attached
          (token count managed in the blocks panel)
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// History section — chronological opLog
// ---------------------------------------------------------------------------

function OpEntry({
  op,
  ws,
  onFragmentClick,
}: {
  op: Operation;
  ws: Workspace;
  onFragmentClick?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(op.type === "ai-generated");

  const ts = fmtTimestamp(op.timestamp);

  // Renderers by op type. Most show a one-line summary; ai-generated /
  // reroll get an expandable body with prompt + result.
  if (op.type === "ai-generated") {
    const result = op.fragmentId ? ws.fragments[op.fragmentId] : null;
    return (
      <div className="border border-stone-800 rounded">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-baseline gap-3 px-3 py-2 text-left hover:bg-stone-900/50 transition-colors"
        >
          <span className="text-[10px] uppercase tracking-wider text-blue-400/80">
            ai-gen
          </span>
          <span className="text-[10px] text-stone-600 tabular-nums">{ts}</span>
          <span className="text-[10px] text-stone-700">· {op.model}</span>
          {op.ephemeral && (
            <span className="text-[10px] text-stone-500 italic">ephemeral</span>
          )}
          {op.durationMs !== undefined && (
            <span className="text-[10px] text-stone-700">· {fmtDuration(op.durationMs)}</span>
          )}
          <span className="text-[10px] text-stone-700 ml-auto">
            {expanded ? "▾" : "▸"}
          </span>
        </button>
        {expanded && (
          <div className="px-3 py-2 border-t border-stone-800 space-y-3 bg-stone-950">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-stone-500 mb-1">
                prompt
              </div>
              <pre className="text-[11px] text-stone-400 whitespace-pre-wrap font-mono leading-relaxed">
                {op.prompt || "(no prompt recorded)"}
              </pre>
            </div>
            {result && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-stone-500 mb-1 flex items-baseline gap-2">
                  <span>output</span>
                  <button
                    onClick={() => onFragmentClick?.(result.id)}
                    className="text-stone-700 hover:text-stone-400 font-mono"
                  >
                    {shortId(result.id)}
                  </button>
                  {result.timing?.durationMs ? (
                    <span className="text-stone-700">
                      · {(result.timing.durationMs / 1000).toFixed(1)}s
                    </span>
                  ) : null}
                </div>
                <div className="text-xs text-stone-300 leading-relaxed">
                  <MarkdownText>{fragmentPreview(result.content, 800)}</MarkdownText>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (op.type === "human-typed") {
    return (
      <div className="px-3 py-2 border border-stone-800 rounded">
        <div className="flex items-baseline gap-3 text-[10px] mb-1">
          <span className="uppercase tracking-wider text-emerald-500/80">user-typed</span>
          <span className="text-stone-600 tabular-nums">{ts}</span>
        </div>
        <div className="text-xs text-stone-300 leading-relaxed">
          <MarkdownText>{fragmentPreview(op.content)}</MarkdownText>
        </div>
      </div>
    );
  }

  if (op.type === "merge") {
    const result = ws.fragments[op.resultId];
    return (
      <div className="border border-stone-800 rounded">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-baseline gap-3 px-3 py-2 text-left hover:bg-stone-900/50 transition-colors"
        >
          <span className="uppercase tracking-wider text-[10px] text-violet-400/80">merge</span>
          {op.mergeType && (
            <span className="text-[10px] text-stone-700">· {op.mergeType}</span>
          )}
          <span className="text-[10px] text-stone-600 tabular-nums">{ts}</span>
          {op.model && <span className="text-[10px] text-stone-700">· {op.model}</span>}
          {op.durationMs !== undefined && (
            <span className="text-[10px] text-stone-700">· {fmtDuration(op.durationMs)}</span>
          )}
          <span className="text-[10px] text-stone-700 font-mono">
            {op.sourceIds.map(shortId).join(" + ")} → {shortId(op.resultId)}
          </span>
          <span className="text-[10px] text-stone-700 ml-auto">
            {expanded ? "▾" : "▸"}
          </span>
        </button>
        {expanded && (
          <div className="px-3 py-2 border-t border-stone-800 space-y-3 bg-stone-950">
            {op.prompt && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-stone-500 mb-1">
                  prompt
                </div>
                <pre className="text-[11px] text-stone-400 whitespace-pre-wrap font-mono leading-relaxed">
                  {op.prompt}
                </pre>
              </div>
            )}
            {result && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-stone-500 mb-1">
                  output
                </div>
                <div className="text-xs text-stone-300 leading-relaxed">
                  <MarkdownText>{fragmentPreview(result.content, 800)}</MarkdownText>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (op.type === "reroll") {
    return (
      <div className="border border-stone-800 rounded">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-baseline gap-3 px-3 py-2 text-left hover:bg-stone-900/50 transition-colors"
        >
          <span className="uppercase tracking-wider text-[10px] text-amber-400/80">reroll</span>
          <span className="text-[10px] text-stone-600 tabular-nums">{ts}</span>
          <span className="text-[10px] text-stone-700">· {op.model}</span>
          {op.durationMs !== undefined && (
            <span className="text-[10px] text-stone-700">· {fmtDuration(op.durationMs)}</span>
          )}
          {op.selectedText && (
            <span className="text-[10px] text-stone-500 italic">
              "{op.selectedText.length > 30 ? op.selectedText.slice(0, 30) + "…" : op.selectedText}"
            </span>
          )}
          <span className="text-[10px] text-stone-700 ml-auto">
            {op.resultIds.length > 0 ? `${op.resultIds.length} persisted` : "ephemeral"}
            {" "}{expanded ? "▾" : "▸"}
          </span>
        </button>
        {expanded && op.prompt && (
          <div className="px-3 py-2 border-t border-stone-800 bg-stone-950">
            <div className="text-[10px] uppercase tracking-wider text-stone-500 mb-1">
              prompt
            </div>
            <pre className="text-[11px] text-stone-400 whitespace-pre-wrap font-mono leading-relaxed">
              {op.prompt}
            </pre>
          </div>
        )}
      </div>
    );
  }

  if (op.type === "split") {
    return (
      <div className="px-3 py-1.5 text-[10px] flex items-baseline gap-3 text-stone-600">
        <span className="uppercase tracking-wider">split</span>
        <span className="tabular-nums">{ts}</span>
        <span className="font-mono">
          {shortId(op.sourceFragmentId)} → {op.resultIds.length} parts
        </span>
      </div>
    );
  }

  if (op.type === "unmerge") {
    return (
      <div className="px-3 py-1.5 text-[10px] flex items-baseline gap-3 text-stone-600">
        <span className="uppercase tracking-wider">unmerge</span>
        <span className="tabular-nums">{ts}</span>
        <span className="font-mono">
          {shortId(op.mergedId)} → {op.restoredIds.length} restored
        </span>
      </div>
    );
  }

  if (op.type === "expand") {
    return (
      <div className="border border-stone-800 rounded">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-baseline gap-3 px-3 py-2 text-left hover:bg-stone-900/50 transition-colors"
        >
          <span className="uppercase tracking-wider text-[10px] text-fuchsia-400/80">expand</span>
          {op.mode && <span className="text-[10px] text-stone-700">· {op.mode}</span>}
          <span className="text-[10px] text-stone-600 tabular-nums">{ts}</span>
          {op.model && <span className="text-[10px] text-stone-700">· {op.model}</span>}
          {op.durationMs !== undefined && (
            <span className="text-[10px] text-stone-700">· {fmtDuration(op.durationMs)}</span>
          )}
          <span className="text-[10px] text-stone-700 font-mono">
            {shortId(op.sourceFragmentId)} → {op.resultIds.length} frag
          </span>
          <span className="text-[10px] text-stone-700 ml-auto">
            {expanded ? "▾" : "▸"}
          </span>
        </button>
        {expanded && op.prompt && (
          <div className="px-3 py-2 border-t border-stone-800 bg-stone-950">
            <div className="text-[10px] uppercase tracking-wider text-stone-500 mb-1">prompt</div>
            <pre className="text-[11px] text-stone-400 whitespace-pre-wrap font-mono leading-relaxed">
              {op.prompt}
            </pre>
          </div>
        )}
      </div>
    );
  }

  if (op.type === "draft") {
    return (
      <div className="border border-stone-800 rounded">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-baseline gap-3 px-3 py-2 text-left hover:bg-stone-900/50 transition-colors"
        >
          <span className="uppercase tracking-wider text-[10px] text-cyan-400/80">draft</span>
          <span className="text-[10px] text-stone-600 tabular-nums">{ts}</span>
          <span className="text-[10px] text-stone-700">· {op.model}</span>
          {op.durationMs !== undefined && (
            <span className="text-[10px] text-stone-700">· {fmtDuration(op.durationMs)}</span>
          )}
          <span className="text-[10px] text-stone-700">
            {op.resultIds.length} drafts of {shortId(op.parentId)}
          </span>
          <span className="text-[10px] text-stone-700 ml-auto">
            {expanded ? "▾" : "▸"}
          </span>
        </button>
        {expanded && op.prompt && (
          <div className="px-3 py-2 border-t border-stone-800 bg-stone-950">
            <div className="text-[10px] uppercase tracking-wider text-stone-500 mb-1">prompt template</div>
            <pre className="text-[11px] text-stone-400 whitespace-pre-wrap font-mono leading-relaxed">
              {op.prompt}
            </pre>
          </div>
        )}
      </div>
    );
  }

  if (op.type === "swap-phrase") {
    return (
      <div className="border border-stone-800 rounded">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-baseline gap-3 px-3 py-2 text-left hover:bg-stone-900/50 transition-colors"
        >
          <span className="uppercase tracking-wider text-[10px] text-emerald-400/80">swap</span>
          <span className="text-[10px] text-stone-600 tabular-nums">{ts}</span>
          <span className="text-[10px] text-stone-700">· {op.method}</span>
          {op.durationMs !== undefined && (
            <span className="text-[10px] text-stone-700">· {fmtDuration(op.durationMs)}</span>
          )}
          <span className="text-[10px] text-stone-500 italic">
            "{op.originalPhrase.length > 20 ? op.originalPhrase.slice(0, 20) + "…" : op.originalPhrase}"
            <span className="not-italic text-stone-700"> → </span>
            "{op.alternativePhrase.length > 20 ? op.alternativePhrase.slice(0, 20) + "…" : op.alternativePhrase}"
          </span>
          <span className="text-[10px] text-stone-700 ml-auto">
            {op.swapCount}× {expanded ? "▾" : "▸"}
          </span>
        </button>
        {expanded && op.prompt && (
          <div className="px-3 py-2 border-t border-stone-800 bg-stone-950">
            <div className="text-[10px] uppercase tracking-wider text-stone-500 mb-1">prompt</div>
            <pre className="text-[11px] text-stone-400 whitespace-pre-wrap font-mono leading-relaxed">
              {op.prompt}
            </pre>
          </div>
        )}
      </div>
    );
  }

  // Fallback for low-signal ops (move, prune, restore, zone-transfer, pick)
  return (
    <div className="px-3 py-1 text-[10px] text-stone-700 flex items-baseline gap-3">
      <span className="uppercase tracking-wider">{op.type}</span>
      <span className="tabular-nums">{ts}</span>
    </div>
  );
}

function History({ ws, onFragmentClick }: { ws: Workspace; onFragmentClick?: (id: string) => void }) {
  const ops = useMemo(() => [...ws.opLog].reverse(), [ws.opLog]);

  return (
    <section>
      <h3 className="text-[10px] uppercase tracking-wider text-stone-500 mb-3">
        history ({ops.length} op{ops.length === 1 ? "" : "s"})
      </h3>
      {ops.length === 0 ? (
        <div className="text-xs text-stone-600 italic">no operations yet</div>
      ) : (
        <div className="space-y-2">
          {ops.map((op, i) => (
            <OpEntry
              key={`${op.timestamp}-${i}`}
              op={op}
              ws={ws}
              onFragmentClick={onFragmentClick}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export default function ChatView({ ws, onFragmentClick }: ChatViewProps) {
  return (
    <div className="w-full h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6 font-mono text-stone-300">
        <NextAssembly ws={ws} onFragmentClick={onFragmentClick} />
        <History ws={ws} onFragmentClick={onFragmentClick} />
      </div>
    </div>
  );
}
