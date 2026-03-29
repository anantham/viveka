import { NextRequest, NextResponse } from "next/server";
import { getTree } from "@/lib/tree-store";

export async function POST(req: NextRequest) {
  const { id } = await req.json();
  const tree = getTree(id);
  if (!tree) {
    return NextResponse.json({ error: "Tree not found" }, { status: 404 });
  }
  return NextResponse.json(tree);
}
