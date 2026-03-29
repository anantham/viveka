import { NextRequest, NextResponse } from "next/server";
import { loadLibrary, addToLibrary, removeFromLibrary } from "@/lib/context-library";

export async function GET() {
  return NextResponse.json(loadLibrary());
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, content, source } = body as {
    name: string;
    content: string;
    source: "paste" | "file" | "url";
  };
  if (!name || !content) {
    return NextResponse.json({ error: "name and content required" }, { status: 400 });
  }
  const block = addToLibrary(name, content, source);
  return NextResponse.json(block);
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  const removed = removeFromLibrary(id);
  return NextResponse.json({ removed });
}
