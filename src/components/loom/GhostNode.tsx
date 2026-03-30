"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface GhostNodeProps {
  position: { x: number; y: number };
  nodeWidth: number;
  onGenerate: () => void;
  onSubmitMessage: (text: string) => void;
  isGenerating: boolean;
}

export default function GhostNode({
  position,
  nodeWidth,
  onGenerate,
  onSubmitMessage,
  isGenerating,
}: GhostNodeProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Focus the textarea when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmitMessage(trimmed);
    setText("");
    setIsEditing(false);
  }, [text, onSubmitMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
      if (e.key === "Escape") {
        setText("");
        setIsEditing(false);
      }
    },
    [handleSubmit]
  );

  const handleClick = useCallback(() => {
    if (!isEditing && !isGenerating) {
      setIsEditing(true);
    }
  }, [isEditing, isGenerating]);

  const handleGenerate = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onGenerate();
    },
    [onGenerate]
  );

  return (
    <div
      className="absolute"
      style={{
        left: position.x,
        top: position.y,
        width: nodeWidth,
      }}
    >
      {isGenerating ? (
        <div className="w-full rounded-xl border-2 border-dashed border-amber-700/40 px-4 py-4 text-sm text-amber-600/60 animate-pulse cursor-wait text-center">
          generating...
        </div>
      ) : isEditing ? (
        <div className="w-full rounded-xl border-2 border-dashed border-blue-700/50 bg-stone-900/60 px-4 py-3 transition-all">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message..."
            rows={3}
            className="w-full bg-transparent border-none text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none resize-y min-h-[60px]"
          />
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={handleSubmit}
              disabled={!text.trim()}
              className="text-xs px-3 py-1 rounded-lg bg-blue-900/60 border border-blue-700/50 text-blue-300 hover:bg-blue-800/60 hover:border-blue-600/50 disabled:opacity-30 transition-colors"
            >
              Send
            </button>
            <button
              onClick={handleGenerate}
              className="text-xs px-3 py-1 rounded-lg bg-stone-800/60 border border-stone-700/50 text-stone-400 hover:bg-stone-700/60 hover:text-stone-300 transition-colors"
              title="Continue the conversation without user input"
            >
              Generate
            </button>
            <button
              onClick={() => {
                setText("");
                setIsEditing(false);
              }}
              className="text-xs text-stone-600 hover:text-stone-400 ml-auto transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div
          onClick={handleClick}
          className="w-full rounded-xl border-2 border-dashed border-stone-700/50 px-4 py-4 text-sm text-stone-600 hover:border-stone-500 hover:text-stone-400 hover:bg-stone-800/30 cursor-pointer transition-all flex items-center justify-center gap-3"
        >
          <span>+ type a message</span>
          <span className="text-stone-700">|</span>
          <button
            onClick={handleGenerate}
            className="text-stone-600 hover:text-stone-300 transition-colors"
          >
            generate next
          </button>
        </div>
      )}
    </div>
  );
}
