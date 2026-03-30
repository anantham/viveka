"use client";

import { TreeNode } from "@/lib/tree";

interface ChatBubbleViewProps {
  nodes: TreeNode[];
  onNodeClick: (nodeId: string) => void;
  onEdit: (nodeId: string, content: string) => void;
  siblingCounts: Record<string, number>; // nodeId → number of siblings
  editingId: string | null;
  onEditStart: (nodeId: string) => void;
  onEditCancel: () => void;
}

export default function ChatBubbleView({
  nodes,
  onNodeClick,
  onEdit,
  siblingCounts,
  editingId,
  onEditStart,
  onEditCancel,
}: ChatBubbleViewProps) {
  return (
    <div className="flex flex-col gap-3 py-4 px-4">
      {nodes.map((node) => {
        if (node.role === "system") return null;
        const isUser = node.role === "user";
        const isEditing = editingId === node.id;
        const siblings = siblingCounts[node.id] || 1;
        const isDraft = node.source === "ai-draft";
        const isGenerating = node.status === "generating";

        return (
          <div
            key={node.id}
            className={`flex ${isUser ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`group relative max-w-[80%] ${
                isUser
                  ? "bg-blue-950/60 border-blue-800/50"
                  : "bg-stone-800/80 border-stone-700/50"
              } border rounded-2xl ${
                isUser ? "rounded-br-md" : "rounded-bl-md"
              } px-4 py-2.5 cursor-pointer transition-all hover:border-stone-500`}
              onClick={() => onNodeClick(node.id)}
            >
              {/* Sibling indicator */}
              {siblings > 1 && (
                <div className="absolute -top-2 -right-2 bg-stone-700 text-stone-300 text-[10px] rounded-full w-5 h-5 flex items-center justify-center">
                  {siblings}
                </div>
              )}

              {/* Draft indicator */}
              {isDraft && (
                <div className="text-[10px] text-blue-400 mb-1 uppercase tracking-wider">
                  ai draft
                </div>
              )}

              {/* Content */}
              {isEditing ? (
                <EditBubble
                  content={node.content}
                  onSave={(c) => onEdit(node.id, c)}
                  onCancel={onEditCancel}
                />
              ) : isGenerating ? (
                <div className="text-sm text-stone-500 animate-pulse">
                  Generating...
                </div>
              ) : node.status === "error" ? (
                <div className="text-sm text-red-400">
                  Error: {node.error || "generation failed"}
                </div>
              ) : (
                <div className="text-sm text-stone-200 whitespace-pre-wrap leading-relaxed">
                  {node.content}
                </div>
              )}

              {/* Version + timing indicator */}
              <div className="flex gap-2 mt-1">
                {node.version > 1 && (
                  <span className="text-[10px] text-stone-600">
                    v{node.version}
                  </span>
                )}
                {node.timing && (
                  <span className="text-[10px] text-stone-700 tabular-nums">
                    {node.timing.durationMs < 1000
                      ? `${node.timing.durationMs}ms`
                      : `${(node.timing.durationMs / 1000).toFixed(1)}s`}
                    {node.model && ` · ${node.model}`}
                  </span>
                )}
              </div>

              {/* Hover actions */}
              {!isEditing && node.status === "complete" && (
                <div className="absolute -bottom-6 left-0 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditStart(node.id);
                    }}
                    className="text-[10px] text-stone-600 hover:text-stone-400"
                  >
                    edit
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EditBubble({
  content,
  onSave,
  onCancel,
}: {
  content: string;
  onSave: (content: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(content);
  return (
    <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full bg-stone-900 border border-stone-600 rounded px-2 py-1 text-sm text-stone-200 focus:outline-none focus:border-stone-400 resize-y min-h-[60px]"
        rows={3}
        autoFocus
      />
      <div className="flex gap-2">
        <button
          onClick={() => onSave(text)}
          className="text-xs px-2 py-0.5 bg-stone-700 rounded text-stone-300 hover:bg-stone-600"
        >
          Save
        </button>
        <button
          onClick={onCancel}
          className="text-xs text-stone-600 hover:text-stone-400"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// Need to import useState for EditBubble
import { useState } from "react";
