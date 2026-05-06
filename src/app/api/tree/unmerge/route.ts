import { NextRequest, NextResponse } from "next/server";
import { getWorkspace, saveWorkspace } from "@/lib/workspace-store";
import { unmergeFragments } from "@/lib/workspace";

/**
 * POST /api/tree/unmerge
 *
 * Reverse a merge: restore the source fragments' original contents
 * (popped from previousVersions which the merge endpoint stashed
 * before overwriting), put them back into sequence at roughly their
 * original positions (using the preMergeSnapshot in the opLog), and
 * delete the merged fragment along with its derivation edges.
 *
 * Body: { treeId, mergedId }
 * Returns: { ok, restoredIds }
 */
export async function POST(req: NextRequest) {
  const { treeId, mergedId } = (await req.json()) as {
    treeId: string;
    mergedId: string;
  };

  if (!treeId || !mergedId) {
    return NextResponse.json(
      { error: "Missing required fields: treeId, mergedId" },
      { status: 400 }
    );
  }

  const ws = getWorkspace(treeId);
  if (!ws) return NextResponse.json({ error: "Tree not found" }, { status: 404 });

  const result = unmergeFragments(ws, mergedId);
  if (!result.ok) {
    const status = result.error === "Merged fragment not found" ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  saveWorkspace(ws);

  console.log(
    `[unmerge] restored ${result.restoredIds.length} fragments from merged ${mergedId.slice(0, 8)}`,
  );

  return NextResponse.json({ ok: true, restoredIds: result.restoredIds });
}
