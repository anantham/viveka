"use client";

import { useEffect, useState } from "react";

/**
 * Time-bounded unmerge flash. After a merge completes, this badge
 * auto-shows for UNMERGE_FLASH_MS so the writer sees the undo
 * affordance without having to hover. The same action is also
 * reachable via the hover toolbar permanently — the flash window
 * just makes "oh that's not what I wanted" reactions obvious.
 */
export const UNMERGE_FLASH_MS = 30000;

export default function UnmergeFlashBadge({
  fragmentId,
  completedAtIso,
  onUnmerge,
}: {
  fragmentId: string;
  completedAtIso: string;
  onUnmerge: (id: string) => void;
}) {
  const completedAt = new Date(completedAtIso).getTime();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const initialRemaining = UNMERGE_FLASH_MS - (Date.now() - completedAt);
    if (initialRemaining <= 0) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    const t = setTimeout(() => clearInterval(id), initialRemaining + 50);
    return () => {
      clearInterval(id);
      clearTimeout(t);
    };
  }, [completedAt]);
  const elapsed = now - completedAt;
  if (elapsed >= UNMERGE_FLASH_MS) return null;
  const remaining = Math.ceil((UNMERGE_FLASH_MS - elapsed) / 1000);
  // Fade out over the last ~1.2s
  const opacity =
    elapsed > UNMERGE_FLASH_MS - 1200
      ? Math.max(0, (UNMERGE_FLASH_MS - elapsed) / 1200)
      : 1;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onUnmerge(fragmentId);
      }}
      className="absolute -top-7 right-2 z-50 px-2 py-0.5 rounded bg-rose-950/80 border border-rose-700/60 text-[10px] text-rose-200 font-mono pointer-events-auto hover:text-rose-100 hover:bg-rose-900/80 transition-colors"
      style={{ opacity, transition: "opacity 200ms ease-out, background-color 150ms, color 150ms" }}
      title="Restore the two original fragments and remove this merged result"
    >
      ↶ unmerge · {remaining}s
    </button>
  );
}
