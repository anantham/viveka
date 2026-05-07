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
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [dragItemCount, setDragItemCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);

  // Close the +add menu on outside click
  useEffect(() => {
    if (!addMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setAddMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [addMenuOpen]);

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

  // Walk a single drag-drop entry (file or directory) recursively and
  // collect File objects with their relative paths. Browser API:
  // webkitGetAsEntry → FileSystemEntry → either FileSystemFileEntry
  // (.file) or FileSystemDirectoryEntry (.createReader → readEntries).
  const collectEntries = (entry: FileSystemEntry, prefix: string): Promise<File[]> =>
    new Promise((resolve, reject) => {
      if (entry.isFile) {
        (entry as FileSystemFileEntry).file(
          (file) => {
            // Stamp the relative path so display names preserve folder
            // structure (e.g. "notes/april.md" not just "april.md").
            try {
              Object.defineProperty(file, "webkitRelativePath", {
                value: prefix + file.name,
                writable: false,
              });
            } catch {
              /* ignore — some browsers refuse re-defining the property */
            }
            resolve([file]);
          },
          reject,
        );
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        const all: File[] = [];
        const readBatch = () => {
          reader.readEntries(async (entries) => {
            if (entries.length === 0) {
              resolve(all);
              return;
            }
            for (const sub of entries) {
              const subFiles = await collectEntries(sub, prefix + entry.name + "/");
              all.push(...subFiles);
            }
            // readEntries can return in batches — keep going until empty.
            readBatch();
          }, reject);
        };
        readBatch();
      } else {
        resolve([]);
      }
    });

  // Extract files from a drop event's DataTransferItemList. Handles both
  // dropped files and dropped folders (recurses into folders). Falls
  // back to dt.files if the entry API isn't available.
  const filesFromDataTransfer = async (dt: DataTransfer): Promise<File[]> => {
    const items = dt.items;
    if (items && items.length > 0 && typeof items[0].webkitGetAsEntry === "function") {
      const entries: FileSystemEntry[] = [];
      for (let i = 0; i < items.length; i++) {
        const e = items[i].webkitGetAsEntry?.();
        if (e) entries.push(e);
      }
      const groups = await Promise.all(entries.map((e) => collectEntries(e, "")));
      return groups.flat();
    }
    return Array.from(dt.files ?? []);
  };

  // Read uploaded files (from <input type="file"> or drag-drop) and add
  // each as a context block. Filters to .md / .txt / .markdown by
  // extension. Reads contents client-side via File.text() so the
  // server never needs an absolute path.
  const handleUploadedFiles = async (fileList: FileList | File[] | null) => {
    if (!fileList) return;
    const arr = Array.isArray(fileList) ? fileList : Array.from(fileList);
    if (arr.length === 0) return;
    const allowed = /\.(md|markdown|txt)$/i;
    const files = arr.filter((f) => allowed.test(f.name));
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
      // Clear the input so re-selecting the same file fires onChange again
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const files = await filesFromDataTransfer(e.dataTransfer);
    await handleUploadedFiles(files);
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

      {/* Single + add block ▾ dropdown — collapses paste / file / library
          into one entry point with a small popover menu. */}
      <div className="px-4 py-1.5 relative" ref={addMenuRef}>
        <button
          onClick={() => setAddMenuOpen((v) => !v)}
          className={`text-xs px-2 py-0.5 rounded border transition-colors ${
            addMenuOpen || showAdd
              ? "border-stone-500 text-stone-300"
              : "border-stone-700 text-stone-600 hover:text-stone-400"
          }`}
        >
          + add block ▾
        </button>
        {addMenuOpen && (
          <div className="absolute left-4 top-7 z-50 bg-stone-900 border border-stone-700 rounded shadow-xl w-44 py-1 text-xs">
            {(
              [
                { key: "paste", label: "Paste text", desc: "type or paste raw text" },
                { key: "file", label: "Upload file/folder", desc: "drag-drop or browse" },
                { key: "library", label: "From library", desc: "saved blocks across sessions" },
              ] as const
            ).map(({ key, label, desc }) => (
              <button
                key={key}
                onClick={() => {
                  setShowAdd(showAdd === key ? null : key);
                  setAddMenuOpen(false);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-stone-800 transition-colors"
              >
                <div className="text-stone-200">{label}</div>
                <div className="text-[10px] text-stone-600">{desc}</div>
              </button>
            ))}
          </div>
        )}
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

      {/* Upload — single drop zone handles both files and folders.
          Click opens the multi-file picker; drag a folder onto the zone
          and the recursive walk finds every .md/.txt within. */}
      {showAdd === "file" && (
        <div className="px-4 py-2 space-y-2 border-t border-stone-800/50">
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragEnter={(e) => {
              // dataTransfer.items is available during drag; .length gives
              // the count of top-level items (file or folder). Browsers
              // don't expose folder vs file during drag (only on drop), so
              // we just show the count and let the user know we're ready.
              if (e.dataTransfer?.items?.length) {
                setDragItemCount(e.dataTransfer.items.length);
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (!dragActive) setDragActive(true);
            }}
            onDragLeave={(e) => {
              // Only deactivate when leaving the zone itself, not entering children
              if (e.currentTarget === e.target) {
                setDragActive(false);
                setDragItemCount(0);
              }
            }}
            onDrop={(e) => {
              setDragItemCount(0);
              handleDrop(e);
            }}
            className={`px-4 py-6 rounded border-2 border-dashed text-center cursor-pointer transition-colors ${
              dragActive
                ? "border-emerald-600 bg-emerald-950/30 text-emerald-300"
                : "border-stone-700 hover:border-stone-600 text-stone-500"
            } ${loading ? "opacity-50 pointer-events-none" : ""}`}
          >
            <div className="text-xs">
              {loading
                ? "loading…"
                : dragActive
                  ? dragItemCount > 0
                    ? `drop to add ${dragItemCount} item${dragItemCount === 1 ? "" : "s"}`
                    : "drop to add"
                  : "drop files or a folder here"}
            </div>
            <div className="text-[10px] mt-1 text-stone-600">
              {loading ? "" : "or click to browse files · .md / .markdown / .txt only"}
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            className="hidden"
            onChange={(e) => handleUploadedFiles(e.target.files)}
          />

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
