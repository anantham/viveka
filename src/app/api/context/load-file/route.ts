import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";

export async function POST(req: NextRequest) {
  const { path } = await req.json();

  try {
    const content = readFileSync(path, "utf-8");
    return NextResponse.json({
      content,
      charCount: content.length,
      tokenEstimate: Math.ceil(content.length / 4),
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to read file: ${err}` },
      { status: 400 }
    );
  }
}
