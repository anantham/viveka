"use client";

import { useRef, useEffect, useCallback } from "react";
import { TreeNode } from "@/lib/tree";

interface VersionHistoryProps {
  node: TreeNode;
  onRevert: (nodeId: string, content: string) => void;
  onClose: () => void;
  /** Anchor position relative to the node's top-right corner */
  anchorRect?: DOMRect | null;
}

export default function VersionHistory({
  node,
  onRevert,
  onClose,
  anchorRect,
}: VersionHistoryProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay listener to avoid the opening click immediately closing it
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handleRevert = useCallback(
    (content: string) => {
      onRevert(node.id, content);
      onClose();
    },
    [node.id, onRevert, onClose]
  );

  const hasPreviousVersions = node.previousVersions.length > 0;

  // Truncate text for preview
  const truncate = (text: string, maxLen: number = 80): string => {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen).trimEnd() + "...";
  };

  return (
    <div
      ref={panelRef}
      className="absolute z-50 w-72 max-h-80 overflow-y-auto rounded-lg border border-stone-700 bg-stone-900/95 backdrop-blur-sm shadow-xl"
      style={{
        // Position below the badge, offset slightly
        top: "100%",
        right: 0,
        marginTop: 4,
      }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="sticky top-0 bg-stone-900/95 backdrop-blur-sm border-b border-stone-700/50 px-3 py-2 flex items-center justify-between">
        <span className="text-xs font-medium text-stone-300">
          Version History
        </span>
        <span className="text-[10px] text-stone-500 font-mono">
          v{node.version}
        </span>
      </div>

      {/* Current version */}
      <div className="px-3 py-2 border-b border-stone-800/50">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-mono text-stone-500">
            v{node.version}
          </span>
          <span className="text-[10px] text-green-600">current</span>
        </div>
        <p className="text-xs text-stone-400 leading-relaxed">
          {truncate(node.content)}
        </p>
      </div>

      {/* Previous versions (most recent first) */}
      {hasPreviousVersions ? (
        <>
          {/* Quick undo button */}
          <div className="px-3 py-2 border-b border-stone-800/50">
            <button
              onClick={() =>
                handleRevert(
                  node.previousVersions[node.previousVersions.length - 1]
                )
              }
              className="w-full text-left px-2 py-1.5 text-xs rounded bg-stone-800 hover:bg-stone-700 text-stone-300 hover:text-stone-100 transition-colors flex items-center gap-2"
            >
              <span className="text-amber-500">&#x21B6;</span>
              <span>Undo to v{node.version - 1}</span>
            </button>
          </div>

          {/* Version list */}
          <div className="px-3 py-1">
            {[...node.previousVersions].reverse().map((content, reverseIdx) => {
              const versionNum =
                node.previousVersions.length - reverseIdx;
              return (
                <button
                  key={reverseIdx}
                  onClick={() => handleRevert(content)}
                  className="w-full text-left group py-2 border-b border-stone-800/30 last:border-b-0 hover:bg-stone-800/50 -mx-1 px-1 rounded transition-colors"
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[10px] font-mono text-stone-600">
                      v{versionNum}
                    </span>
                    <span className="text-[10px] text-stone-700 group-hover:text-stone-400 transition-colors">
                      click to revert
                    </span>
                  </div>
                  <p className="text-xs text-stone-500 group-hover:text-stone-300 leading-relaxed transition-colors">
                    {truncate(content)}
                  </p>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <div className="px-3 py-4 text-center">
          <p className="text-xs text-stone-600">No previous versions</p>
        </div>
      )}
    </div>
  );
}
