"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ConversationTree, getActivePath } from "@/lib/tree";
import RetrievePanel from "./RetrievePanel";

interface DumpInterfaceProps {
  initialTree: ConversationTree;
}

interface AmbientState {
  music: string;
  location: string;
  mood: string;
  bodyState: string;
}

export default function DumpInterface({ initialTree }: DumpInterfaceProps) {
  const [tree, setTree] = useState(initialTree);
  const [text, setText] = useState("");
  const [showAmbient, setShowAmbient] = useState(false);
  const [ambient, setAmbient] = useState<AmbientState>({
    music: "",
    location: "",
    mood: "",
    bodyState: "",
  });
  const [saving, setSaving] = useState(false);
  const [blocks, setBlocks] = useState<Array<{ id: string; content: string; timestamp: string }>>([]);
  const [loadedNotePaths, setLoadedNotePaths] = useState<Set<string>>(new Set());
  const [contextNotes, setContextNotes] = useState<Array<{ name: string; charCount: number }>>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoSaveRef = useRef<NodeJS.Timeout | null>(null);

  // Load existing blocks from tree
  useEffect(() => {
    const path = getActivePath(tree);
    const existingBlocks = path
      .filter((n) => n.role === "user" && n.content)
      .map((n) => ({ id: n.id, content: n.content, timestamp: n.createdAt }));
    setBlocks(existingBlocks);
  }, [tree]);

  // Auto-focus the writing area
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Auto-save on pause (2 seconds of no typing)
  useEffect(() => {
    if (!text.trim()) return;

    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(() => {
      saveBlock(text);
    }, 2000);

    return () => {
      if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    };
  }, [text]);

  const saveBlock = useCallback(
    async (content: string) => {
      if (!content.trim() || saving) return;
      setSaving(true);

      try {
        const res = await fetch("/api/dump/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ treeId: tree.id, content: content.trim() }),
        });
        const data = await res.json();
        if (!data.error) {
          setBlocks((prev) => [
            ...prev,
            {
              id: data.node.id,
              content: content.trim(),
              timestamp: data.node.createdAt,
            },
          ]);
          setText("");
          // Refresh tree
          const treeRes = await fetch("/api/tree/get", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: tree.id }),
          });
          const freshTree = await treeRes.json();
          if (!freshTree.error) setTree(freshTree);
        }
      } catch (err) {
        console.error("Failed to save block:", err);
      } finally {
        setSaving(false);
      }
    },
    [tree.id, saving]
  );

  // Combined text for vault search (current input + all saved blocks)
  const allText = [text, ...blocks.map((b) => b.content)].join("\n\n");

  const handleAddNoteToContext = useCallback(
    async (name: string, content: string) => {
      // Add to the tree's context via the context API
      try {
        await fetch("/api/context/add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: tree.id,
            name: `📒 ${name}`,
            content,
            source: "file",
          }),
        });
        setContextNotes((prev) => [...prev, { name, charCount: content.length }]);
        // Mark as loaded to hide from suggestions
        setLoadedNotePaths((prev) => {
          const next = new Set(prev);
          // We don't have the exact path here, but the name is unique enough
          next.add(name);
          return next;
        });
      } catch (err) {
        console.error("Failed to add note to context:", err);
      }
    },
    [tree.id]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Cmd+Enter = force save now (don't wait for auto-save)
    if (e.key === "Enter" && e.metaKey) {
      e.preventDefault();
      if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
      saveBlock(text);
    }
  };

  // Transition to LOOM when ready to expand
  const handleExpandToLoom = () => {
    window.location.href = `/loom/${tree.id}`;
  };

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const totalWords = blocks.reduce(
    (sum, b) => sum + b.content.split(/\s+/).filter(Boolean).length,
    0
  );

  return (
    <div className="min-h-screen flex flex-col max-w-2xl mx-auto">
      {/* Header — minimal */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-stone-800/30">
        <div className="flex items-center gap-3">
          <a
            href="/"
            className="text-sm font-medium text-stone-600 uppercase tracking-wider hover:text-stone-400"
          >
            Viveka
          </a>
          <span className="text-xs text-stone-700">dump</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowAmbient(!showAmbient)}
            className={`text-xs px-2 py-0.5 rounded border transition-colors ${
              showAmbient
                ? "border-stone-500 text-stone-300"
                : "border-stone-800 text-stone-600 hover:text-stone-400"
            }`}
          >
            ambient
          </button>
          {blocks.length > 0 && (
            <button
              onClick={handleExpandToLoom}
              className="text-xs px-2 py-0.5 rounded border border-emerald-800 text-emerald-500 hover:text-emerald-400 hover:border-emerald-700 transition-colors"
            >
              → expand in LOOM
            </button>
          )}
        </div>
      </header>

      {/* Ambient context — collapsible */}
      {showAmbient && (
        <div className="px-6 py-3 border-b border-stone-800/20 grid grid-cols-2 gap-2">
          <input
            type="text"
            value={ambient.music}
            onChange={(e) =>
              setAmbient((a) => ({ ...a, music: e.target.value }))
            }
            placeholder="🎵 music / soundtrack"
            className="bg-transparent border border-stone-800/50 rounded px-2 py-1 text-xs text-stone-400 placeholder:text-stone-700 focus:outline-none focus:border-stone-600"
          />
          <input
            type="text"
            value={ambient.location}
            onChange={(e) =>
              setAmbient((a) => ({ ...a, location: e.target.value }))
            }
            placeholder="📍 location / setting"
            className="bg-transparent border border-stone-800/50 rounded px-2 py-1 text-xs text-stone-400 placeholder:text-stone-700 focus:outline-none focus:border-stone-600"
          />
          <input
            type="text"
            value={ambient.mood}
            onChange={(e) =>
              setAmbient((a) => ({ ...a, mood: e.target.value }))
            }
            placeholder="mood / emotional tone"
            className="bg-transparent border border-stone-800/50 rounded px-2 py-1 text-xs text-stone-400 placeholder:text-stone-700 focus:outline-none focus:border-stone-600"
          />
          <input
            type="text"
            value={ambient.bodyState}
            onChange={(e) =>
              setAmbient((a) => ({ ...a, bodyState: e.target.value }))
            }
            placeholder="🧘 body state"
            className="bg-transparent border border-stone-800/50 rounded px-2 py-1 text-xs text-stone-400 placeholder:text-stone-700 focus:outline-none focus:border-stone-600"
          />
        </div>
      )}

      {/* Previous blocks — faded, scrollable */}
      {blocks.length > 0 && (
        <div className="px-6 py-4 space-y-3 border-b border-stone-800/20 max-h-[40vh] overflow-y-auto">
          {blocks.map((block) => (
            <div key={block.id} className="text-sm text-stone-500 leading-relaxed">
              {block.content}
            </div>
          ))}
        </div>
      )}

      {/* The writing surface — the main event */}
      <div className="flex-1 px-6 py-6">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Write freely. No questions will be asked. Auto-saves after 2 seconds of pause. Cmd+Enter to save immediately."
          className="w-full h-full min-h-[300px] bg-transparent text-stone-200 text-base leading-relaxed placeholder:text-stone-700 focus:outline-none resize-none"
        />
      </div>

      {/* Vault references — auto-detected from your writing */}
      <RetrievePanel
        text={allText}
        onAddToContext={handleAddNoteToContext}
        loadedPaths={loadedNotePaths}
      />

      {/* Loaded context notes indicator */}
      {contextNotes.length > 0 && (
        <div className="px-6 py-2 border-t border-stone-800/20 flex flex-wrap gap-2">
          {contextNotes.map((note, i) => (
            <span
              key={i}
              className="text-[10px] text-stone-600 px-1.5 py-0.5 bg-stone-800/50 rounded"
            >
              📒 {note.name} ({(note.charCount / 1000).toFixed(1)}k)
            </span>
          ))}
        </div>
      )}

      {/* Footer — subtle stats */}
      <footer className="px-6 py-3 border-t border-stone-800/20 flex items-center justify-between text-xs text-stone-700">
        <div className="flex gap-4">
          <span>{wordCount} words</span>
          {blocks.length > 0 && (
            <span>
              {blocks.length} blocks · {totalWords} total words
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {saving && (
            <span className="text-stone-600 animate-pulse">saving...</span>
          )}
          {!saving && text.trim() && (
            <span className="text-stone-700">auto-saves on pause</span>
          )}
        </div>
      </footer>
    </div>
  );
}
