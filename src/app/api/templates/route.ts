import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

interface IntentTemplate {
  intent: string;
  completionCondition: string;
  mode: string;
  frequency: number;
  category: string;
}

interface Category {
  id: string;
  label: string;
  description: string;
  count: number;
  percentage: number;
  dominantMode: string;
}

interface TemplatesFile {
  categories: Category[];
  templates: IntentTemplate[];
}

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), ".viveka-data", "intent-templates.json");
    const raw = fs.readFileSync(filePath, "utf-8");
    const data: TemplatesFile = JSON.parse(raw);

    return NextResponse.json({
      templates: data.templates ?? [],
      categories: (data.categories ?? []).map((c) => ({
        id: c.id,
        label: c.label,
        description: c.description,
        dominantMode: c.dominantMode,
      })),
    });
  } catch (err: unknown) {
    // File not found or parse error — return empty gracefully
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ templates: [], categories: [] });
    }
    console.error("Failed to load intent templates:", err);
    return NextResponse.json({ templates: [], categories: [] });
  }
}
