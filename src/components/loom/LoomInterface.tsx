"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ConversationTree, getActivePath, getSiblings } from "@/lib/tree";
import ChatBubbleView from "./ChatBubbleView";
import TreeMapView from "./TreeMapView";
import CanvasView from "./CanvasView";

interface LoomInterfaceProps {
  initialTree: ConversationTree;
}

type View = "chat" | "tree" | "split" | "canvas";

export default function LoomInterface({ initialTree }: LoomInterfaceProps) {
  const [tree, setTree] = useState(initialTree);
  const [view, setView] = useState<View>("split");
  const [input, setInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Poll for generating nodes
  const hasGenerating = Object.values(tree.nodes).some(
    (n) => n.status === "generating"
  );

  useEffect(() => {
    if (hasGenerating && !polling) {
      setPolling(true);
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch("/api/tree/get", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: tree.id }),
          });
          const freshTree = await res.json();
          if (!freshTree.error) {
            setTree(freshTree);
            const stillGenerating = Object.values(
              freshTree.nodes as Record<string, { status: string }>
            ).some((n) => n.status === "generating");
            if (!stillGenerating) {
              if (pollRef.current) clearInterval(pollRef.current);
              setPolling(false);
            }
          }
        } catch {
          // ignore polling errors
        }
      }, 1500);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [hasGenerating, polling, tree.id]);

  const activePath = getActivePath(tree);
  const lastNode = activePath[activePath.length - 1];

  // Sibling counts for bubble indicators
  const siblingCounts: Record<string, number> = {};
  for (const node of activePath) {
    const sibs = getSiblings(tree, node.id);
    siblingCounts[node.id] = sibs.length;
  }

  const refreshTree = useCallback(async () => {
    const res = await fetch("/api/tree/get", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: tree.id }),
    });
    const data = await res.json();
    if (!data.error) setTree(data);
  }, [tree.id]);

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
    // Add user node
    const parentId = lastNode?.id;
    if (!parentId) return;

    // Create user node by adding to tree manually
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
    if (!data.error) {
      await refreshTree();
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
    await fetch("/api/tree/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ treeId: tree.id, parentId: lastNode.id }),
    });
    await refreshTree();
  };

  const handleDraft = async () => {
    if (!lastNode) return;
    const parentId = lastNode.role === "assistant" ? lastNode.id : lastNode.parentId;
    if (!parentId) return;

    await fetch("/api/tree/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ treeId: tree.id, parentId }),
    });
    await refreshTree();
  };

  const handleEdit = async (nodeId: string, content: string) => {
    await fetch("/api/tree/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ treeId: tree.id, nodeId, content }),
    });
    setEditingId(null);
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

  return (
    <div className="flex flex-col h-screen max-w-5xl mx-auto">
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
          {(["chat", "split", "tree", "canvas"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                view === v
                  ? "border-stone-500 text-stone-300"
                  : "border-stone-700 text-stone-600 hover:text-stone-400"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </header>

      {/* Intent */}
      <div className="px-4 py-2 border-b border-stone-800/50 text-xs text-stone-600">
        {tree.intent}
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Canvas view */}
        {view === "canvas" && (
          <div className="w-full h-full">
            <CanvasView
              tree={tree}
              onGenerate={() => {
                if (lastNode) {
                  if (lastNode.role === "assistant" || lastNode.role === "system") {
                    // Need user input first — focus the input
                    inputRef.current?.focus();
                  } else {
                    handleReroll();
                  }
                }
              }}
              onNodeSelect={handleNodeSelect}
              onNodeEdit={handleEdit}
              isGenerating={hasGenerating}
            />
          </div>
        )}

        {/* Chat bubble view */}
        {(view === "chat" || view === "split") && (
          <div
            className={`${view === "split" ? "w-1/2 border-r border-stone-800" : "w-full"} overflow-y-auto`}
          >
            <ChatBubbleView
              nodes={activePath}
              onNodeClick={handleNodeSelect}
              onEdit={handleEdit}
              siblingCounts={siblingCounts}
              editingId={editingId}
              onEditStart={setEditingId}
              onEditCancel={() => setEditingId(null)}
            />

            {/* Sibling navigation for last node */}
            {lastNode && siblingCounts[lastNode.id] > 1 && (
              <div className="flex items-center justify-center gap-3 py-2">
                <button
                  onClick={() => handleNavigateSibling("prev")}
                  className="text-xs text-stone-600 hover:text-stone-400 px-2 py-1 border border-stone-700 rounded"
                >
                  ← prev
                </button>
                <span className="text-xs text-stone-600">
                  {getSiblings(tree, lastNode.id).findIndex(
                    (n) => n.id === lastNode.id
                  ) + 1}
                  /{siblingCounts[lastNode.id]}
                </span>
                <button
                  onClick={() => handleNavigateSibling("next")}
                  className="text-xs text-stone-600 hover:text-stone-400 px-2 py-1 border border-stone-700 rounded"
                >
                  next →
                </button>
              </div>
            )}
          </div>
        )}

        {/* Tree map view */}
        {(view === "tree" || view === "split") && (
          <div
            className={`${view === "split" ? "w-1/2" : "w-full"} overflow-auto bg-stone-950`}
          >
            <TreeMapView
              tree={tree}
              onNodeSelect={handleNodeSelect}
              onPrune={handlePrune}
              onUnprune={handleUnprune}
            />
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="border-t border-stone-800 bg-stone-900/50">
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
  );
}
