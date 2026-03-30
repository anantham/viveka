"use client";

import { CursorTool } from "@/lib/canvas-utils";

interface CursorToolSwitcherProps {
  activeTool: CursorTool;
  onToolChange: (tool: CursorTool) => void;
}

const TOOLS: { id: CursorTool; label: string; icon: string; shortcut: string }[] = [
  { id: "select", label: "Select", icon: "I", shortcut: "1" },
  { id: "tangent", label: "Tangent", icon: "\u2726", shortcut: "2" },
  { id: "hand", label: "Grab", icon: "\u270B", shortcut: "3" },
];

export default function CursorToolSwitcher({
  activeTool,
  onToolChange,
}: CursorToolSwitcherProps) {
  return (
    <div className="flex items-center bg-stone-900/90 border border-stone-700 rounded-lg overflow-hidden backdrop-blur-sm">
      {TOOLS.map((tool) => (
        <button
          key={tool.id}
          onClick={() => onToolChange(tool.id)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${
            activeTool === tool.id
              ? "bg-stone-700 text-stone-200"
              : "text-stone-500 hover:text-stone-300 hover:bg-stone-800"
          }`}
          title={`${tool.label} (${tool.shortcut})`}
        >
          <span className="text-sm">{tool.icon}</span>
          <span className="hidden sm:inline">{tool.label}</span>
        </button>
      ))}
    </div>
  );
}
