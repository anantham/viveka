"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ConversationTree } from "@/lib/tree";
import DumpInterface from "@/components/DumpInterface";

export default function DumpPage() {
  const params = useParams();
  const treeId = params.id as string;
  const [tree, setTree] = useState<ConversationTree | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadTree() {
      try {
        const res = await fetch("/api/tree/get", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: treeId }),
        });
        const data = await res.json();
        if (data.error) {
          setError(data.error);
        } else {
          setTree(data);
        }
      } catch (err) {
        setError(`Failed to load: ${err}`);
      }
    }
    loadTree();
  }, [treeId]);

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-sm text-red-400">{error}</p>
          <a href="/" className="inline-block px-4 py-2 text-sm bg-stone-800 border border-stone-600 rounded text-stone-300 hover:bg-stone-700">Home</a>
        </div>
      </main>
    );
  }

  if (!tree) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-stone-600 animate-pulse">Loading...</p>
      </main>
    );
  }

  return <DumpInterface initialTree={tree} />;
}
