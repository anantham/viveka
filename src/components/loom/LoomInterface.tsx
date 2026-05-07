"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Workspace, Fragment } from "@/lib/workspace";
import { getSiblings as getWsSiblings, getChildren, getWorkspaceContext } from "@/lib/workspace";
import type { TreeNode, ConversationTree } from "@/lib/tree";
import { Session, ContextBlock, estimateTokens, MAX_CONTEXT_TOKENS } from "@/lib/types";
import ChatView from "./ChatView";
import ReaderView from "./ReaderView";
import TreeView from "./TreeView";
import CanvasView from "./CanvasView";
import WorkspaceCanvas from "./WorkspaceCanvas";
import PatternOverlay from "../PatternOverlay";
import UsageMeters from "../UsageMeters";
import ContextPanel from "../ContextPanel";
import LLMSettings from "../LLMSettings";
import HelpOverlay from "./HelpOverlay";

interface LoomInterfaceProps {
  initialTree: Workspace;
}

/**
 * Convert a Fragment to a TreeNode-compatible shape for legacy views.
 * This shim lets us migrate views one at a time.
 */
function fragmentToNode(f: Fragment, ws: Workspace): TreeNode {
  const isAI = f.provenance.type === "ai-generated" || f.provenance.type === "derived";
  // Find parent via edges
  const parentEdge = ws.edges.find((e) => e.to === f.id && e.type === "responded-to");
  // Find children via edges
  const childEdges = ws.edges.filter((e) => e.from === f.id && e.type === "responded-to");

  return {
    id: f.id,
    parentId: parentEdge?.from ?? null,
    role: f.provenance.type === "system" ? "system" : isAI ? "assistant" : "user",
    content: f.content,
    childIds: childEdges.map((e) => e.to),
    source: isAI ? "ai-completion" : "human",
    status: f.status,
    pruned: false,
    selected: ws.sequence.includes(f.id),
    version: f.version,
    previousVersions: f.previousVersions,
    createdAt: f.createdAt,
    model: f.provenance.model,
    error: f.error,
    timing: f.timing,
    provenance: f.provenance,
  };
}

/**
 * Build a legacy ConversationTree shape from Workspace for views that still need it.
 */
function wsToLegacyTree(ws: Workspace): ConversationTree {
  const nodes: Record<string, TreeNode> = {};
  for (const f of Object.values(ws.fragments)) {
    nodes[f.id] = fragmentToNode(f, ws);
  }
  // Find root (fragment with no parent edge)
  const hasParent = new Set(ws.edges.filter((e) => e.type === "responded-to").map((e) => e.to));
  const rootId = Object.keys(ws.fragments).find((id) => !hasParent.has(id)) || ws.sequence[0] || "";

  return {
    id: ws.id,
    createdAt: ws.createdAt,
    intent: ws.intent,
    completionCondition: ws.completionCondition,
    mode: ws.mode,
    nodes,
    rootId,
    activePathIds: ws.sequence,
    settings: ws.settings,
    contextBlockIds: ws.contextBlockIds,
    canvasPositions: ws.canvasPositions,
    sequence: ws.sequence,
    opLog: ws.opLog as ConversationTree["opLog"],
  };
}

type View = "chat" | "reader" | "tree" | "canvas";

// Cycle order for the view-switcher button. Click cycles forward,
// shift+click cycles backward, keyboard `V` cycles forward. Split
// is no longer a view — it's a layout mode (see splitPane state).
const VIEW_CYCLE: View[] = ["canvas", "reader", "chat", "tree"];

/** An entry in the node-level undo stack. Stores the content before a mutation. */
interface UndoEntry {
  nodeId: string;
  previousContent: string;
  timestamp: number;
}

const MAX_UNDO_STACK = 50;

/** Get siblings as TreeNode[] for legacy views */
function getSiblings(tree: ConversationTree, nodeId: string): TreeNode[] {
  const node = tree.nodes[nodeId];
  if (!node || !node.parentId) return [node].filter(Boolean);
  const parent = tree.nodes[node.parentId];
  if (!parent) return [node];
  return parent.childIds
    .map((id) => tree.nodes[id])
    .filter((n): n is TreeNode => !!n && !n.pruned);
}

export default function LoomInterface({ initialTree }: LoomInterfaceProps) {
  const [ws, setWs] = useState(initialTree);
  // Legacy tree shape for views that haven't migrated yet
  const tree = wsToLegacyTree(ws);
  const [view, setView] = useState<View>("canvas");
  // Optional second pane. When non-null, layout splits 50/50 with `view`
  // on the left and `splitPane` on the right. Each pane has its own
  // cycle button. Default split companion = "chat" (the X-ray).
  const [splitPane, setSplitPane] = useState<View | null>(null);
  const [input, setInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [virtualSession, setVirtualSession] = useState<Session | null>(null);
  const [showContextPanel, setShowContextPanel] = useState(false);
  const [contextBlocks, setContextBlocks] = useState<ContextBlock[]>([]);
  const [exporting, setExporting] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // Cycle through views. Wraps around at both ends. `pane` controls
  // which slot is being cycled — primary (the main view) or split
  // (the secondary pane when split layout is on).
  const cycleView = useCallback(
    (direction: 1 | -1 = 1, pane: "primary" | "split" = "primary") => {
      const advance = (v: View) => {
        const i = VIEW_CYCLE.indexOf(v);
        return VIEW_CYCLE[(i + direction + VIEW_CYCLE.length) % VIEW_CYCLE.length];
      };
      if (pane === "primary") setView(advance);
      else setSplitPane((v) => (v ? advance(v) : "chat"));
    },
    [],
  );

  const toggleSplit = useCallback(() => {
    setSplitPane((cur) => {
      if (cur) return null;
      // Default: pair with chat (the x-ray) if not already viewing chat,
      // otherwise pair with canvas. The "useful complement" heuristic.
      return view === "chat" ? "canvas" : "chat";
    });
  }, [view]);
  const [fullscreen, setFullscreen] = useState(false);
  const [exportResult, setExportResult] = useState<{ path?: string; error?: string } | null>(null);
  const prevHasGenerating = useRef(false);
  const undoStackRef = useRef<UndoEntry[]>([]);

  // Poll for generating nodes
  const hasGenerating = Object.values(ws.fragments).some(
    (f) => f.status === "generating"
  );
  const pollingRef = useRef(false);

  useEffect(() => {
    if (!hasGenerating) {
      // Nothing generating — stop any active poll
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      if (pollingRef.current) {
        console.log(`[viveka-ui] polling stopped — no more generating nodes`);
        pollingRef.current = false;
        setPolling(false);
      }
      return;
    }

    // Has generating nodes — start polling if not already
    if (pollingRef.current) return;
    pollingRef.current = true;
    setPolling(true);

    const pollStart = performance.now();
    let pollCount = 0;
    const treeId = tree.id;
    console.log(`[viveka-ui] polling started at ${new Date().toISOString().slice(11, 23)}`);

    pollRef.current = setInterval(async () => {
      pollCount++;
      try {
        const res = await fetch("/api/tree/get", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: treeId }),
        });
        const freshTree = await res.json();
        if (!freshTree.error) {
          setWs(freshTree);
          const stillGenerating = Object.values(
            freshTree.nodes as Record<string, { status: string }>
          ).some((n) => n.status === "generating");
          if (!stillGenerating) {
            console.log(`[viveka-ui] polling done after ${pollCount} polls, ${(performance.now() - pollStart).toFixed(0)}ms total`);
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
            pollingRef.current = false;
            setPolling(false);
          }
        }
      } catch {
        // ignore polling errors
      }
    }, 1500);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      pollingRef.current = false;
    };
  }, [hasGenerating, tree.id]);

  // Active path = sequence fragments converted to TreeNode for legacy views
  const activePath = ws.sequence
    .map((id) => ws.fragments[id])
    .filter((f): f is Fragment => !!f)
    .map((f) => fragmentToNode(f, ws));
  const lastNode = activePath[activePath.length - 1];

  // Sibling counts for bubble indicators
  const siblingCounts: Record<string, number> = {};
  for (const node of activePath) {
    const sibs = getWsSiblings(ws, node.id);
    siblingCounts[node.id] = sibs.length;
  }

  const refreshTree = useCallback(async () => {
    const res = await fetch("/api/tree/get", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: ws.id }),
    });
    const data = await res.json();
    if (!data.error) setWs(data);
  }, [ws.id]);

  // --- Session-based features bridge ---

  const fetchVirtualSession = useCallback(async () => {
    try {
      const res = await fetch("/api/tree/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ treeId: ws.id }),
      });
      const data = await res.json();
      if (!data.error) setVirtualSession(data);
    } catch {
      // session overlay is non-critical
    }
  }, [ws.id]);

  // When generation completes, refresh the virtual session
  useEffect(() => {
    if (prevHasGenerating.current && !hasGenerating) {
      console.log(`[viveka-ui] all generations complete at ${new Date().toISOString().slice(11, 23)}`);
      fetchVirtualSession();
    }
    prevHasGenerating.current = hasGenerating;
  }, [hasGenerating, fetchVirtualSession]);

  // Fetch virtual session on mount / tree change
  useEffect(() => {
    fetchVirtualSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.id]);

  const handleExportToObsidian = async () => {
    setExporting(true);
    setExportResult(null);
    try {
      const res = await fetch("/api/tree/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ treeId: tree.id }),
      });
      const data = await res.json();
      if (data.error) {
        setExportResult({ error: data.error });
      } else {
        setExportResult({ path: data.obsidianPath });
      }
    } catch {
      setExportResult({ error: "Network error during export" });
    } finally {
      setExporting(false);
    }
  };

  // Compute context usage from the canonical Workspace. The gauge needs
  // to reflect what the LLM would actually see if the writer generated
  // next: every fragment in the active sequence + the intent/condition
  // (which IS the root system fragment in getWorkspaceContext) + any
  // enabled external context blocks. Independent of view — same number
  // shows on canvas, chat, reader, tree.
  const contextBlockTokens = contextBlocks
    .filter((b) => b.enabled)
    .reduce((sum, b) => sum + b.tokenEstimate, 0);
  const historyTokens = getWorkspaceContext(ws).reduce(
    (sum, f) => sum + estimateTokens(f.content),
    0,
  );
  const contextUsage = {
    contextBlockTokens,
    historyTokens,
    totalTokens: historyTokens + contextBlockTokens,
    maxTokens: MAX_CONTEXT_TOKENS,
  };

  // Find the last exchange with an active intervention warning
  const lastIntervention = virtualSession?.exchanges
    .filter((ex) => ex.interventionShown)
    .pop();

  const handleSend = async () => {
    if (!input.trim()) return;
    const userMessage = input.trim();
    setInput("");

    // Add user node, then generate completions
    const addRes = await fetch("/api/tree/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        treeId: tree.id,
        nodeId: "NEW",
        content: userMessage,
      }),
    });

    // Actually, we need to add a node first. Let me use a direct approach:
    // 1. Add user node to tree
    // 2. Generate N completions

    // Use the generate endpoint which expects a user node as parent
    // First, create the user node via edit of a pending node
    // Simpler: POST to a combined endpoint
    await sendUserMessage(userMessage);
  };

  const sendUserMessage = async (message: string) => {
    const t0 = performance.now();
    console.log(`[viveka-ui] send: "${message.slice(0, 50)}..." at ${new Date().toISOString().slice(11, 23)}`);

    const parentId = lastNode?.id;
    if (!parentId) return;

    const res = await fetch("/api/tree/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        treeId: tree.id,
        parentId,
        userMessage: message,
      }),
    });
    const data = await res.json();
    console.log(`[viveka-ui] generate API returned in ${(performance.now() - t0).toFixed(0)}ms — ${data.nodeIds?.length ?? 0} pending nodes`);
    if (!data.error) {
      await refreshTree();
      console.log(`[viveka-ui] tree refreshed at ${(performance.now() - t0).toFixed(0)}ms — now polling for completions`);
    }
  };

  const handleNodeSelect = async (nodeId: string) => {
    await fetch("/api/tree/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ treeId: tree.id, nodeId }),
    });
    await refreshTree();
  };

  const handleReroll = async () => {
    if (!lastNode || lastNode.role !== "user") return;
    const t0 = performance.now();
    console.log(`[viveka-ui] reroll started at ${new Date().toISOString().slice(11, 23)}`);
    await fetch("/api/tree/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ treeId: tree.id, parentId: lastNode.id }),
    });
    console.log(`[viveka-ui] reroll API returned in ${(performance.now() - t0).toFixed(0)}ms`);
    await refreshTree();
  };

  // Ephemeral extend: ask for N candidate continuations, return them as
  // strings without creating any fragments. The canvas renders them
  // inline as ghost continuations; commit happens via handleCommitExtend.
  const handleExtend = async (
    parentFragmentId: string
  ): Promise<{ alternatives: string[] } | null> => {
    const t0 = performance.now();
    console.log(`[viveka-ui] extend ephemeral from fragment ${parentFragmentId.slice(0, 8)}`);
    try {
      const res = await fetch("/api/tree/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          treeId: tree.id, parentId: parentFragmentId,
          ephemeral: true,
          count: 3,
        }),
      });
      const data = await res.json();
      console.log(`[viveka-ui] extend returned in ${(performance.now() - t0).toFixed(0)}ms — ${data.alternatives?.length ?? 0} continuations`);
      return { alternatives: data.alternatives ?? [] };
    } catch (err) {
      console.error("[viveka-ui] extend failed:", err);
      return null;
    }
  };

  // Reverse a merge — restores the source fragments' originals (from
  // their previousVersions stash that the merge endpoint preserved)
  // and removes the merged fragment.
  const handleUnmerge = async (mergedId: string) => {
    console.log(`[viveka-ui] unmerge merged fragment ${mergedId.slice(0, 8)}`);
    await fetch("/api/tree/unmerge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ treeId: tree.id, nodeId: mergedId, mergedId }),
    });
    await refreshTree();
  };

  // Commit the chosen continuation as a single new child fragment.
  // No siblings are created — only the selected one persists.
  const handleCommitExtend = async (parentFragmentId: string, content: string) => {
    console.log(`[viveka-ui] commit extend under ${parentFragmentId.slice(0, 8)} (${content.length} chars)`);
    await fetch("/api/tree/append-child", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ treeId: tree.id, parentId: parentFragmentId, content }),
    });
    await refreshTree();
  };

  // Ephemeral phrase reroll: returns just the N alternative phrase strings
  // without writing any sibling fragments to the workspace. The canvas
  // previews them in place; commit happens via handleCommitPhraseEdit.
  const handleReplace = async (
    fragmentId: string,
    selectedText: string,
    fullContent: string
  ): Promise<{ alternatives: string[] } | null> => {
    const t0 = performance.now();
    console.log(`[viveka-ui] reroll-phrase ephemeral for fragment ${fragmentId.slice(0, 8)}: "${selectedText.slice(0, 40)}..."`);
    try {
      const res = await fetch("/api/tree/reroll-phrase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          treeId: tree.id, nodeId: fragmentId, selectedText, fullContent,
          ephemeral: true,
        }),
      });
      const data = await res.json();
      console.log(`[viveka-ui] reroll-phrase returned in ${(performance.now() - t0).toFixed(0)}ms — ${data.alternatives?.length ?? 0} alternatives`);
      // No refresh needed — ephemeral mode wrote nothing
      return { alternatives: data.alternatives ?? [] };
    } catch (err) {
      console.error("[viveka-ui] reroll-phrase failed:", err);
      return null;
    }
  };

  // Commit the chosen alternative as an in-place edit on the source
  // fragment. No new nodes; the original gets new content.
  const handleCommitPhraseEdit = async (fragmentId: string, newContent: string) => {
    console.log(`[viveka-ui] commit phrase edit on fragment ${fragmentId.slice(0, 8)}`);
    await fetch("/api/tree/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ treeId: tree.id, nodeId: fragmentId, content: newContent }),
    });
    await refreshTree();
  };

  const handleDraft = async () => {
    if (!lastNode) return;
    const parentId = lastNode.role === "assistant" ? lastNode.id : lastNode.parentId;
    if (!parentId) return;

    const t0 = performance.now();
    console.log(`[viveka-ui] draft started at ${new Date().toISOString().slice(11, 23)}`);
    const res = await fetch("/api/tree/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ treeId: tree.id, parentId }),
    });
    const data = await res.json();
    console.log(`[viveka-ui] draft API returned in ${(performance.now() - t0).toFixed(0)}ms`, data.error || `${data.nodeIds?.length ?? 0} pending`);
    await refreshTree();
    console.log(`[viveka-ui] draft tree refreshed at ${(performance.now() - t0).toFixed(0)}ms — polling for completions`);
  };

  const pushUndo = useCallback((nodeId: string, previousContent: string) => {
    undoStackRef.current = [
      ...undoStackRef.current.slice(-(MAX_UNDO_STACK - 1)),
      { nodeId, previousContent, timestamp: Date.now() },
    ];
  }, []);

  const handleEdit = async (nodeId: string, content: string) => {
    // Save current content to undo stack before editing
    const currentNode = tree.nodes[nodeId];
    if (currentNode && currentNode.content !== content) {
      pushUndo(nodeId, currentNode.content);
    }

    await fetch("/api/tree/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ treeId: tree.id, nodeId, content }),
    });
    setEditingId(null);
    await refreshTree();
  };

  const handleUndo = useCallback(async () => {
    const entry = undoStackRef.current.pop();
    if (!entry) return;

    await fetch("/api/tree/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        treeId: tree.id,
        nodeId: entry.nodeId,
        content: entry.previousContent,
      }),
    });
    await refreshTree();
  }, [tree.id, refreshTree]);

  const handleSplitRange = async (nodeId: string, charStart: number, charEnd: number) => {
    await fetch("/api/tree/split-range", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ treeId: tree.id, fragmentId: nodeId, charStart, charEnd }),
    });
    await refreshTree();
  };

  const handleMoveFragment = async (fragmentId: string, toIndex: number) => {
    await fetch("/api/tree/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ treeId: tree.id, fragmentId, toIndex }),
    });
    await refreshTree();
  };

  const handleZoneTransfer = async (fragmentId: string, toZone: string) => {
    await fetch("/api/tree/zone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ treeId: tree.id, fragmentId, toZone }),
    });
    await refreshTree();
  };

  const handlePrune = async (nodeId: string) => {
    await fetch("/api/tree/prune", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ treeId: tree.id, nodeId, pruned: true }),
    });
    await refreshTree();
  };

  const handleUnprune = async (nodeId: string) => {
    await fetch("/api/tree/prune", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ treeId: tree.id, nodeId, pruned: false }),
    });
    await refreshTree();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Cmd+1/2/3/4 jumps directly to a view, Cmd+Z undoes,
  // bare `v` cycles through views (forward; shift+v cycles backward).
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const inField =
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLInputElement;

      // Bare `v` — cycle view. Ignore if typing in a field or with modifiers.
      if (
        (e.key === "v" || e.key === "V") &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !inField
      ) {
        e.preventDefault();
        cycleView(e.shiftKey ? -1 : 1);
        return;
      }

      if (!e.metaKey && !e.ctrlKey) return;

      // Cmd+Z — undo last node mutation
      if (e.key === "z" && !e.shiftKey) {
        if (inField) return;
        e.preventDefault();
        handleUndo();
        return;
      }

      const viewMap: Record<string, View> = { "1": "chat", "2": "reader", "3": "tree", "4": "canvas" };
      if (viewMap[e.key]) {
        e.preventDefault();
        setView(viewMap[e.key]);
      }
      // Cmd+\ toggles split layout (mnemonic: \ visually splits a screen)
      if (e.key === "\\") {
        e.preventDefault();
        toggleSplit();
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [handleUndo, cycleView, toggleSplit]);

  // Navigate siblings with arrow keys
  const handleNavigateSibling = async (direction: "prev" | "next") => {
    if (!lastNode || !lastNode.parentId) return;
    const sibs = getSiblings(tree, lastNode.id).filter((n) => !n.pruned);
    const idx = sibs.findIndex((n) => n.id === lastNode.id);
    const nextIdx =
      direction === "next"
        ? (idx + 1) % sibs.length
        : (idx - 1 + sibs.length) % sibs.length;
    if (sibs[nextIdx]) {
      await handleNodeSelect(sibs[nextIdx].id);
    }
  };

  const nodeCount = Object.keys(tree.nodes).length;
  const branchCount = Object.values(tree.nodes).filter(
    (n) => n.childIds.length > 1
  ).length;

  // Fullscreen canvas — no header, no action bar, just the workspace
  if (fullscreen && view === "canvas") {
    return (
      <div className="h-screen w-screen relative">
        <WorkspaceCanvas
          workspace={ws}
          onSplitRange={handleSplitRange}
          onMoveFragment={handleMoveFragment}
          onZoneTransfer={handleZoneTransfer}
          onEdit={handleEdit}
          onGenerate={handleExtend}
          onReplace={handleReplace}
          onCommitPhraseEdit={handleCommitPhraseEdit}
          onCommitExtend={handleCommitExtend}
          onUnmerge={handleUnmerge}
          onSubmitMessage={sendUserMessage}
          onSelectFragment={async (fragId) => {
            await fetch("/api/tree/zone", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ treeId: ws.id, fragmentId: fragId, toZone: "workspace" }),
            });
            await refreshTree();
          }}
          onRefresh={refreshTree}
          isGenerating={hasGenerating}
        />
        <button
          onClick={() => setFullscreen(false)}
          className="absolute top-3 right-3 z-50 text-xs px-2 py-1 bg-stone-800/80 border border-stone-700 rounded text-stone-400 hover:text-stone-200 hover:bg-stone-700"
        >
          ⤡
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-full">
      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-stone-800">
        <div className="flex items-center gap-4">
          <a href="/" className="text-sm font-medium text-stone-500 uppercase tracking-wider hover:text-stone-400">
            Viveka
          </a>
          <span className="text-xs text-stone-600">LOOM</span>
          <span className="text-xs text-stone-700">
            {nodeCount} nodes · {branchCount} branches
          </span>
        </div>
        <div className="flex items-center gap-2">
          <LLMSettings
            onExport={handleExportToObsidian}
            exporting={exporting}
          />
          <UsageMeters rateLimit={null} contextUsage={contextUsage} />
          <button
            onClick={() => setShowContextPanel((v) => !v)}
            className={`text-xs px-2 py-0.5 rounded border transition-colors ${
              showContextPanel
                ? "border-stone-500 text-stone-300"
                : "border-stone-700 text-stone-600 hover:text-stone-400"
            }`}
            title="Toggle context-blocks panel (paste/file/library refs added to LLM context)"
          >
            blocks
          </button>
          <button
            onClick={() => setShowHelp(true)}
            className="text-xs px-2 py-0.5 rounded border border-stone-700 text-stone-600 hover:text-stone-400 transition-colors font-mono"
            title="Show canvas gestures and shortcuts"
          >
            ?
          </button>
          <button
            onClick={(e) => cycleView(e.shiftKey ? -1 : 1, "primary")}
            className="text-xs px-2 py-0.5 rounded border border-stone-500 text-stone-300 hover:text-stone-200 transition-colors min-w-[88px] flex items-center justify-between gap-2"
            title="Cycle view (V) · shift+click reverses"
          >
            <span>{view}</span>
            <span className="text-stone-500 text-[10px]">▸</span>
          </button>
          <button
            onClick={toggleSplit}
            className={`text-xs px-2 py-0.5 rounded border transition-colors ${
              splitPane
                ? "border-stone-500 text-stone-300"
                : "border-stone-700 text-stone-600 hover:text-stone-400"
            }`}
            title="Toggle split layout (⌘\\)"
          >
            split
          </button>
          {splitPane && (
            <button
              onClick={(e) => cycleView(e.shiftKey ? -1 : 1, "split")}
              className="text-xs px-2 py-0.5 rounded border border-stone-500 text-stone-300 hover:text-stone-200 transition-colors min-w-[88px] flex items-center justify-between gap-2"
              title="Cycle right pane · shift+click reverses"
            >
              <span>{splitPane}</span>
              <span className="text-stone-500 text-[10px]">▸</span>
            </button>
          )}
        </div>
      </header>

      {/* Export result toast */}
      {exportResult && (
        <div
          className={`px-4 py-2 text-xs border-b ${
            exportResult.error
              ? "border-red-800 bg-red-950/30 text-red-400"
              : "border-emerald-800 bg-emerald-950/30 text-emerald-400"
          }`}
        >
          {exportResult.error
            ? `Export failed: ${exportResult.error}`
            : `Exported to ${exportResult.path}`}
          <button
            onClick={() => setExportResult(null)}
            className="ml-2 text-stone-600 hover:text-stone-400"
          >
            dismiss
          </button>
        </div>
      )}

      {/* Intent */}
      <div className="px-4 py-2 border-b border-stone-800/50 text-xs text-stone-600">
        {tree.intent}
      </div>

      {/* Context panel (toggled) */}
      {showContextPanel && (
        <ContextPanel
          sessionId={tree.id}
          blocks={contextBlocks}
          onBlocksChange={setContextBlocks}
        />
      )}

      {/* Intervention warning banner */}
      {lastIntervention?.interventionShown && (
        <div
          className={`px-4 py-2 text-xs border-b ${
            lastIntervention.interventionShown.type === "stop" ||
            lastIntervention.interventionShown.type === "pause"
              ? "border-red-800 bg-red-950/30 text-red-300"
              : lastIntervention.interventionShown.type === "warning"
                ? "border-amber-800 bg-amber-950/30 text-amber-300"
                : "border-blue-800 bg-blue-950/30 text-blue-300"
          }`}
        >
          <span className="font-medium uppercase mr-2">
            {lastIntervention.interventionShown.type}:
          </span>
          {lastIntervention.interventionShown.message}
        </div>
      )}

      {/* Main content. Single pane → that view fills width.
          Split → primary view on left, splitPane on right (50/50). */}
      <div className="flex-1 flex overflow-hidden">
        {(splitPane ? [view, splitPane] : [view]).map((paneView, paneIdx) => {
          const isSplit = !!splitPane;
          const wrapperClass = isSplit
            ? `w-1/2 ${paneIdx === 0 ? "border-r border-stone-800" : ""} overflow-hidden flex flex-col relative`
            : "w-full h-full overflow-hidden flex flex-col relative";
          return (
            <div key={`pane-${paneIdx}-${paneView}`} className={wrapperClass}>
              {paneView === "canvas" && (
                <div className="w-full h-full relative">
                  <WorkspaceCanvas
                    workspace={ws}
                    onSplitRange={handleSplitRange}
                    onMoveFragment={handleMoveFragment}
                    onZoneTransfer={handleZoneTransfer}
                    onEdit={handleEdit}
                    onGenerate={handleExtend}
                    onReplace={handleReplace}
                    onCommitPhraseEdit={handleCommitPhraseEdit}
                    onCommitExtend={handleCommitExtend}
                    onUnmerge={handleUnmerge}
                    onSubmitMessage={sendUserMessage}
                    onSelectFragment={async (fragId) => {
                      await fetch("/api/tree/zone", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ treeId: ws.id, fragmentId: fragId, toZone: "workspace" }),
                      });
                      await refreshTree();
                    }}
                    onRefresh={refreshTree}
                    isGenerating={hasGenerating}
                  />
                  {!isSplit && (
                    <button
                      onClick={() => setFullscreen(true)}
                      className="absolute bottom-3 right-3 z-40 text-xs px-2 py-1 bg-stone-800/80 border border-stone-700 rounded text-stone-400 hover:text-stone-200"
                      title="Fullscreen canvas"
                    >
                      ⤢
                    </button>
                  )}
                </div>
              )}
              {paneView === "chat" && (
                <ChatView ws={ws} onFragmentClick={handleNodeSelect} />
              )}
              {paneView === "reader" && (
                <div className="w-full overflow-y-auto">
                  <ReaderView
                    fragments={ws.sequence
                      .map((id) => ws.fragments[id])
                      .filter((f): f is Fragment => !!f)}
                    onEdit={handleEdit}
                    onFragmentClick={handleNodeSelect}
                    onSplitRange={handleSplitRange}
                    onMoveToStage={(fragId) => handleZoneTransfer(fragId, "stage")}
                    siblingCounts={siblingCounts}
                    onNavigateSibling={async (fragId, direction) => {
                      const sibs = getWsSiblings(ws, fragId);
                      const idx = sibs.findIndex((s) => s.id === fragId);
                      if (idx === -1 || sibs.length === 0) return;
                      const nextIdx = direction === "next"
                        ? (idx + 1) % sibs.length
                        : (idx - 1 + sibs.length) % sibs.length;
                      if (sibs[nextIdx]) await handleNodeSelect(sibs[nextIdx].id);
                    }}
                  />
                </div>
              )}
              {paneView === "tree" && (
                <div className="w-full h-full overflow-auto bg-stone-950">
                  <TreeView ws={ws} onSelect={handleNodeSelect} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Action bar — hidden in canvas view (canvas has its own input) */}
      <div className={`border-t border-stone-800 bg-stone-900/50 ${view === "canvas" || splitPane === "canvas" ? "hidden" : ""}`}>
       <div className="max-w-4xl mx-auto w-full">
        {/* Quick actions */}
        <div className="px-4 py-2 flex gap-2 border-b border-stone-800/50">
          <button
            onClick={handleReroll}
            disabled={!lastNode || lastNode.role !== "user" || hasGenerating}
            className="text-xs px-3 py-1 rounded border border-stone-700 text-stone-500 hover:text-stone-300 hover:border-stone-500 disabled:opacity-30 transition-colors"
            title="Generate more completions for the current user message"
          >
            ↻ reroll ({tree.settings.rerollCount})
          </button>
          <button
            onClick={handleDraft}
            disabled={!lastNode || hasGenerating}
            className="text-xs px-3 py-1 rounded border border-stone-700 text-stone-500 hover:text-stone-300 hover:border-stone-500 disabled:opacity-30 transition-colors"
            title="AI suggests what you might say next"
          >
            ✎ draft replies ({tree.settings.draftCount})
          </button>
          {hasGenerating && (
            <span className="text-xs text-amber-600 animate-pulse flex items-center">
              generating...
            </span>
          )}
        </div>

        {/* Input */}
        <div className="px-4 py-3">
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your message, or use 'draft replies' for suggestions..."
              rows={1}
              disabled={hasGenerating}
              className="flex-1 bg-stone-800 border border-stone-600 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:border-stone-500 resize-none disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={hasGenerating || !input.trim()}
              className="px-4 py-2 text-sm bg-stone-800 border border-stone-600 rounded-lg text-stone-300 hover:bg-stone-700 transition-colors disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
       </div>
      </div>
    </div>
  );
}
