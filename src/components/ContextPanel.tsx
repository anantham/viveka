"use client";

import { useState, useEffect, useRef } from "react";
import { ContextBlock, estimateTokens } from "@/lib/types";

interface ContextPanelProps {
  sessionId: string;
  blocks: ContextBlock[];
  onBlocksChange: (blocks: ContextBlock[]) => void;
}

export default function ContextPanel({
  sessionId,
  blocks,
  onBlocksChange,
}: ContextPanelProps) {
  const [library, setLibrary] = useState<ContextBlock[]>([]);
  const [showAdd, setShowAdd] = useState<"paste" | "file" | "library" | null>(null);
  const [pasteName, setPasteName] = useState("");
  const [pasteContent, setPasteContent] = useState("");
  const [filePath, setFilePath] = useState("");
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/context/library")
      .then((r) => r.json())
      .then(setLibrary)
      .catch(console.error);
  }, []);

  const totalTokens = blocks
    .filter((b) => b.enabled)
    .reduce((sum, b) => sum + b.tokenEstimate, 0);

  const addBlock = async (name: string, content: string, source: ContextBlock["source"]) => {
    setLoading(true);
    try {
      const res = await fetch("/api/context/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, name, content, source }),
      });
      const block = await res.json();
      onBlocksChange([...blocks, block]);
    } catch (err) {
      console.error("Failed to add context:", err);
    } finally {
      setLoading(false);
      setShowAdd(null);
      setPasteName("");
      setPasteContent("");
      setFilePath("");
      setFileName("");
    }
  };

  const handlePaste = () => {
    if (!pasteName.trim() || !pasteContent.trim()) return;
    addBlock(pasteName.trim(), pasteContent.trim(), "paste");
  };

  const handleFile = async () => {
    if (!filePath.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/context/load-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath.trim() }),
      });
      const data = await res.json();
      if (data.error) {
        alert(data.error);
        return;
      }
      const name = fileName.trim() || filePath.split("/").pop() || "file";
      await addBlock(name, data.content, "file");
    } catch (err) {
      console.error("Failed to load file:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleLibraryAdd = async (libBlock: ContextBlock) => {
    await addBlock(libBlock.name, libBlock.content, "library");
  };

  // Read uploaded files (from <input type="file"> — single file, multi-file,
  // or webkitdirectory folder) and add each as a context block. Filters
  // to .md / .txt / .markdown by extension since folder upload returns
  // every file in the tree. Reads contents client-side via File.text(),
  // so the server never needs an absolute path.
  const handleUploadedFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const allowed = /\.(md|markdown|txt)$/i;
    const files = Array.from(fileList).filter((f) => allowed.test(f.name));
    if (files.length === 0) {
      alert("No .md / .markdown / .txt files found in the selection.");
      return;
    }
    setLoading(true);
    try {
      const newBlocks: ContextBlock[] = [];
      for (const file of files) {
        // webkitRelativePath is set only for folder uploads; gives the
        // path relative to the chosen folder root (e.g. "notes/2026/april.md").
        const relPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
        const displayName = relPath && relPath.length > 0 ? relPath : file.name;
        const content = await file.text();
        const res = await fetch("/api/context/add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            name: displayName,
            content,
            source: "file",
          }),
        });
        const block = await res.json();
        newBlocks.push(block);
      }
      onBlocksChange([...blocks, ...newBlocks]);
    } catch (err) {
      console.error("Failed to load uploaded files:", err);
      alert(`Failed to load files: ${err instanceof Error ? err.message : err}`);
    } finally {
      setLoading(false);
      setShowAdd(null);
      // Clear the inputs so re-selecting the same file fires onChange again
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (folderInputRef.current) folderInputRef.current.value = "";
    }
  };

  const handleSaveToLibrary = async (block: ContextBlock) => {
    try {
      await fetch("/api/context/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: block.name,
          content: block.content,
          source: block.source,
        }),
      });
      // Refresh library
      const res = await fetch("/api/context/library");
      setLibrary(await res.json());
    } catch (err) {
      console.error("Failed to save to library:", err);
    }
  };

  const toggleBlock = async (blockId: string, enabled: boolean) => {
    await fetch("/api/context/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, blockId, enabled }),
    });
    onBlocksChange(
      blocks.map((b) => (b.id === blockId ? { ...b, enabled } : b))
    );
  };

  const removeBlock = async (blockId: string) => {
    await fetch("/api/context/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, blockId }),
    });
    onBlocksChange(blocks.filter((b) => b.id !== blockId));
  };

  return (
    <div className="border-b border-stone-800 bg-stone-900/30">
      {/* Context blocks list */}
      {blocks.length > 0 && (
        <div className="px-4 py-2 space-y-1">
          {blocks.map((block) => (
            <div
              key={block.id}
              className="flex items-center gap-2 text-xs group"
            >
              <button
                onClick={() => toggleBlock(block.id, !block.enabled)}
                className={`w-3 h-3 rounded-sm border transition-colors ${
                  block.enabled
                    ? "bg-emerald-700 border-emerald-600"
                    : "bg-stone-800 border-stone-600"
                }`}
                title={block.enabled ? "Disable" : "Enable"}
              />
              <span
                className={`flex-1 truncate ${block.enabled ? "text-stone-400" : "text-stone-600 line-through"}`}
                title={`${block.name} (${block.source}, ~${(block.tokenEstimate / 1000).toFixed(1)}k tokens)`}
              >
                {block.name}
              </span>
              <span className="text-stone-700 tabular-nums">
                {block.tokenEstimate > 1000
                  ? `${(block.tokenEstimate / 1000).toFixed(1)}k`
                  : block.tokenEstimate}
              </span>
              <button
                onClick={() => handleSaveToLibrary(block)}
                className="text-stone-700 hover:text-stone-400 opacity-0 group-hover:opacity-100"
                title="Save to library"
              >
                +lib
              </button>
              <button
                onClick={() => removeBlock(block.id)}
                className="text-stone-700 hover:text-red-400 opacity-0 group-hover:opacity-100"
              >
                x
              </button>
            </div>
          ))}
          <div className="text-xs text-stone-600 pt-1">
            Context: ~{(totalTokens / 1000).toFixed(1)}k tokens
          </div>
        </div>
      )}

      {/* Add buttons */}
      <div className="px-4 py-1.5 flex gap-2">
        <button
          onClick={() => setShowAdd(showAdd === "paste" ? null : "paste")}
          className={`text-xs px-2 py-0.5 rounded border transition-colors ${
            showAdd === "paste"
              ? "border-stone-500 text-stone-300"
              : "border-stone-700 text-stone-600 hover:text-stone-400"
          }`}
        >
          + paste
        </button>
        <button
          onClick={() => setShowAdd(showAdd === "file" ? null : "file")}
          className={`text-xs px-2 py-0.5 rounded border transition-colors ${
            showAdd === "file"
              ? "border-stone-500 text-stone-300"
              : "border-stone-700 text-stone-600 hover:text-stone-400"
          }`}
        >
          + file
        </button>
        <button
          onClick={() => setShowAdd(showAdd === "library" ? null : "library")}
          className={`text-xs px-2 py-0.5 rounded border transition-colors ${
            showAdd === "library"
              ? "border-stone-500 text-stone-300"
              : "border-stone-700 text-stone-600 hover:text-stone-400"
          }`}
        >
          + library
        </button>
      </div>

      {/* Paste form */}
      {showAdd === "paste" && (
        <div className="px-4 py-2 space-y-2 border-t border-stone-800/50">
          <input
            type="text"
            value={pasteName}
            onChange={(e) => setPasteName(e.target.value)}
            placeholder="Name (e.g. 'Scott Alexander style reference')"
            className="w-full bg-stone-800 border border-stone-600 rounded px-2 py-1 text-xs text-stone-200 placeholder:text-stone-600 focus:outline-none focus:border-stone-500"
          />
          <textarea
            value={pasteContent}
            onChange={(e) => setPasteContent(e.target.value)}
            placeholder="Paste text content here..."
            rows={4}
            className="w-full bg-stone-800 border border-stone-600 rounded px-2 py-1 text-xs text-stone-200 placeholder:text-stone-600 focus:outline-none focus:border-stone-500 resize-y"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handlePaste}
              disabled={loading || !pasteName.trim() || !pasteContent.trim()}
              className="px-3 py-1 text-xs bg-stone-800 border border-stone-600 rounded text-stone-300 hover:bg-stone-700 disabled:opacity-50"
            >
              {loading ? "Adding..." : "Add to context"}
            </button>
            {pasteContent && (
              <span className="text-xs text-stone-600">
                ~{(estimateTokens(pasteContent) / 1000).toFixed(1)}k tokens
              </span>
            )}
          </div>
        </div>
      )}

      {/* File picker — native browser dialog. Multi-select for files,
          webkitdirectory for folders (recursive); both filter to
          .md / .markdown / .txt before reading. */}
      {showAdd === "file" && (
        <div className="px-4 py-2 space-y-2 border-t border-stone-800/50">
          <div className="flex gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              className="px-3 py-1 text-xs bg-stone-800 border border-stone-600 rounded text-stone-300 hover:bg-stone-700 disabled:opacity-50"
            >
              {loading ? "loading…" : "Choose files…"}
            </button>
            <button
              onClick={() => folderInputRef.current?.click()}
              disabled={loading}
              className="px-3 py-1 text-xs bg-stone-800 border border-stone-600 rounded text-stone-300 hover:bg-stone-700 disabled:opacity-50"
            >
              {loading ? "loading…" : "Choose folder…"}
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            className="hidden"
            onChange={(e) => handleUploadedFiles(e.target.files)}
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            // webkitdirectory + directory are non-standard but supported in
            // Chrome / Edge / Safari / Firefox for folder upload.
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
            className="hidden"
            onChange={(e) => handleUploadedFiles(e.target.files)}
          />
          <div className="text-[10px] text-stone-700">
            .md / .markdown / .txt only · folder picker grabs all matching files recursively
          </div>

          {/* Power-user fallback: server-side absolute path. */}
          <details className="pt-1">
            <summary className="text-[10px] text-stone-700 cursor-pointer hover:text-stone-500">
              or type a server path…
            </summary>
            <div className="space-y-2 pt-2">
              <input
                type="text"
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
                placeholder="Absolute path on the server (e.g. /Users/.../tweets.txt)"
                className="w-full bg-stone-800 border border-stone-600 rounded px-2 py-1 text-xs text-stone-200 placeholder:text-stone-600 focus:outline-none focus:border-stone-500"
              />
              <input
                type="text"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                placeholder="Display name (optional, defaults to filename)"
                className="w-full bg-stone-800 border border-stone-600 rounded px-2 py-1 text-xs text-stone-200 placeholder:text-stone-600 focus:outline-none focus:border-stone-500"
              />
              <button
                onClick={handleFile}
                disabled={loading || !filePath.trim()}
                className="px-3 py-1 text-xs bg-stone-800 border border-stone-600 rounded text-stone-300 hover:bg-stone-700 disabled:opacity-50"
              >
                {loading ? "Loading..." : "Load by path"}
              </button>
            </div>
          </details>
        </div>
      )}

      {/* Library browser */}
      {showAdd === "library" && (
        <div className="px-4 py-2 border-t border-stone-800/50">
          {library.length === 0 ? (
            <p className="text-xs text-stone-600">
              Library empty. Add context blocks and save them with +lib.
            </p>
          ) : (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {library.map((lb) => (
                <div
                  key={lb.id}
                  className="flex items-center gap-2 text-xs"
                >
                  <button
                    onClick={() => handleLibraryAdd(lb)}
                    className="text-emerald-600 hover:text-emerald-400"
                  >
                    +
                  </button>
                  <span className="flex-1 text-stone-400 truncate">
                    {lb.name}
                  </span>
                  <span className="text-stone-700 tabular-nums">
                    {lb.tokenEstimate > 1000
                      ? `${(lb.tokenEstimate / 1000).toFixed(1)}k`
                      : lb.tokenEstimate}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
