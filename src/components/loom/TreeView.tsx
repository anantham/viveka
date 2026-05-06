"use client";

import { useMemo, useState } from "react";
import type { Workspace, Fragment } from "@/lib/workspace";
import { buildTreeFromEdges } from "@/lib/workspace";
import { estimateTokens } from "@/lib/types";

/**
 * TreeView — structural projection of Workspace via responded-to edges.
 *
 * Reads `ws` directly (no ConversationTree bridge). Layout: horizontal
 * tree, root on the left, children flowing right. Each node is
 * click-to-expand: collapsed = compact card with role + 1-line preview;
 * expanded = full content + token count + "open in canvas" link that
 * fires onSelect to navigate.
 *
 * The previous TreeMapView showed nodes as 28px buttons with truncated
 * 40-char text and no way to read content — Aditya called this out:
 * "I can't zoom in and read any of the nodes." Expand-on-click solves
 * exactly that without changing the tree topology.
 */

interface TreeViewProps {
  ws: Workspace;
  onSelect?: (fragmentId: string) => void;
}

function roleOf(f: Fragment): "system" | "user" | "assistant" {
  if (f.provenance.type === "system") return "system";
  if (
    f.provenance.type === "ai-generated" ||
    f.provenance.type === "merged" ||
    f.provenance.type === "derived"
  )
    return "assistant";
  return "user";
}

function preview(content: string, max = 60) {
  if (!content) return "(empty)";
  const single = content.replace(/\s+/g, " ").trim();
  return single.length <= max ? single : single.slice(0, max).trimEnd() + "…";
}

function colorClass(f: Fragment, isInSequence: boolean) {
  const role = roleOf(f);
  if (f.status === "generating") return "bg-amber-900 border-amber-700 animate-pulse";
  if (f.status === "error") return "bg-red-900 border-red-700";
  if (role === "system") return "bg-stone-800 border-stone-600";
  if (role === "user") {
    return isInSequence
      ? "bg-emerald-900/60 border-emerald-700"
      : "bg-emerald-950/50 border-emerald-900";
  }
  return isInSequence
    ? "bg-blue-900/60 border-blue-700"
    : "bg-blue-950/50 border-blue-900";
}

export default function TreeView({ ws, onSelect }: TreeViewProps) {
  const { roots, children } = useMemo(() => buildTreeFromEdges(ws), [ws]);
  const sequenceSet = useMemo(() => new Set(ws.sequence), [ws.sequence]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (roots.length === 0) {
    return (
      <div className="p-6 text-xs text-stone-600 italic">no fragments yet</div>
    );
  }

  return (
    <div className="overflow-auto p-4 select-none font-mono">
      <div className="flex items-start gap-1">
        {roots.map((rootId) => (
          <Branch
            key={rootId}
            ws={ws}
            children_={children}
            sequenceSet={sequenceSet}
            expanded={expanded}
            onToggle={toggle}
            onSelect={onSelect}
            nodeId={rootId}
          />
        ))}
      </div>
      <div className="mt-6 text-[10px] text-stone-700">
        click a node to expand · click again to collapse
      </div>
    </div>
  );
}

function Branch({
  ws,
  children_,
  sequenceSet,
  expanded,
  onToggle,
  onSelect,
  nodeId,
}: {
  ws: Workspace;
  children_: Record<string, string[]>;
  sequenceSet: Set<string>;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onSelect?: (id: string) => void;
  nodeId: string;
}) {
  const node = ws.fragments[nodeId];
  if (!node) return null;
  const kids = (children_[nodeId] ?? [])
    .map((id) => ws.fragments[id])
    .filter((f): f is Fragment => !!f);

  return (
    <div className="flex items-start">
      <NodeCard
        node={node}
        isInSequence={sequenceSet.has(nodeId)}
        isExpanded={expanded.has(nodeId)}
        onToggle={() => onToggle(nodeId)}
        onSelect={onSelect}
      />

      {kids.length > 0 && (
        <div className="flex flex-col gap-1 ml-1">
          {kids.length === 1 ? (
            <div className="flex items-center">
              <div className="w-2 h-px bg-stone-700" />
              <Branch
                ws={ws}
                children_={children_}
                sequenceSet={sequenceSet}
                expanded={expanded}
                onToggle={onToggle}
                onSelect={onSelect}
                nodeId={kids[0].id}
              />
            </div>
          ) : (
            kids.map((child, i) => (
              <div key={child.id} className="flex items-center">
                <div className="relative w-3 h-4">
                  <div className="absolute left-0 top-1/2 w-3 h-px bg-stone-700" />
                  {i === 0 && (
                    <div className="absolute left-0 top-1/2 bottom-0 w-px bg-stone-700" />
                  )}
                  {i === kids.length - 1 && (
                    <div className="absolute left-0 top-0 bottom-1/2 w-px bg-stone-700" />
                  )}
                  {i > 0 && i < kids.length - 1 && (
                    <div className="absolute left-0 top-0 bottom-0 w-px bg-stone-700" />
                  )}
                </div>
                <Branch
                  ws={ws}
                  children_={children_}
                  sequenceSet={sequenceSet}
                  expanded={expanded}
                  onToggle={onToggle}
                  onSelect={onSelect}
                  nodeId={child.id}
                />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function NodeCard({
  node,
  isInSequence,
  isExpanded,
  onToggle,
  onSelect,
}: {
  node: Fragment;
  isInSequence: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onSelect?: (id: string) => void;
}) {
  const role = roleOf(node);
  const klass = colorClass(node, isInSequence);
  const tokens = estimateTokens(node.content);

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={onToggle}
        className={`text-left rounded border px-2 py-1.5 transition-all hover:brightness-125 ${klass} ${
          isInSequence ? "ring-1 ring-white/15" : ""
        } ${isExpanded ? "w-72" : "w-32"}`}
        title={node.id}
      >
        <div className="flex items-baseline gap-2 text-[9px] uppercase tracking-wider opacity-70 mb-0.5">
          <span>{role}</span>
          <span className="ml-auto tabular-nums">{tokens}t</span>
          <span>{isExpanded ? "▾" : "▸"}</span>
        </div>
        <div
          className={`text-[11px] text-stone-200 leading-snug ${
            isExpanded ? "whitespace-pre-wrap" : "truncate"
          }`}
        >
          {role === "system" ? "ROOT · " + preview(node.content, 80) : preview(node.content, isExpanded ? 99999 : 80)}
        </div>
        {isExpanded && (
          <div className="mt-2 pt-2 border-t border-stone-800/60 flex items-baseline gap-3 text-[9px] text-stone-500">
            <span className="font-mono">{node.id.slice(0, 8)}</span>
            {node.timing?.durationMs ? (
              <span>{(node.timing.durationMs / 1000).toFixed(1)}s</span>
            ) : null}
            {onSelect && role !== "system" && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(node.id);
                }}
                className="ml-auto text-stone-400 hover:text-stone-200 underline-offset-2 hover:underline"
              >
                open in canvas →
              </button>
            )}
          </div>
        )}
      </button>
    </div>
  );
}
