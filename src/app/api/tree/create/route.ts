import { NextRequest, NextResponse } from "next/server";
import { createTree } from "@/lib/tree";
import { saveTree } from "@/lib/tree-store";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { intent, completionCondition, mode, settings } = body;

  if (!intent || !completionCondition) {
    return NextResponse.json({ error: "intent and completionCondition required" }, { status: 400 });
  }

  const tree = createTree(intent, completionCondition, mode || "instrumental", settings);
  saveTree(tree);

  return NextResponse.json(tree);
}
