import { NextRequest, NextResponse } from "next/server";
import { getTree } from "@/lib/tree-store";
import { treeToSession } from "@/lib/tree-session-adapter";

/**
 * POST { treeId } -> returns a virtual Session JSON derived from
 * the tree's active path. No data is persisted — this is a read-only
 * projection of the tree into the Session schema.
 */
export async function POST(req: NextRequest) {
  const { treeId } = await req.json();

  if (!treeId) {
    return NextResponse.json(
      { error: "treeId is required" },
      { status: 400 }
    );
  }

  const tree = getTree(treeId);
  if (!tree) {
    return NextResponse.json(
      { error: "Tree not found" },
      { status: 404 }
    );
  }

  const session = treeToSession(tree);
  return NextResponse.json(session);
}
