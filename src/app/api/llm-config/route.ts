import { NextResponse } from "next/server";
import { loadLLMConfig, saveLLMConfig, LLMConfig } from "@/lib/llm-config";

export async function GET() {
  const config = loadLLMConfig();
  // Don't expose the full OpenRouter API key to the frontend
  return NextResponse.json({
    ...config,
    openrouter: {
      ...config.openrouter,
      apiKey: config.openrouter.apiKey
        ? `...${config.openrouter.apiKey.slice(-4)}`
        : "",
    },
  });
}

export async function PUT(req: Request) {
  const body = await req.json();
  const current = loadLLMConfig();

  const updated: LLMConfig = {
    backend: body.backend ?? current.backend,
    ollama: {
      baseUrl: body.ollama?.baseUrl ?? current.ollama.baseUrl,
      model: body.ollama?.model ?? current.ollama.model,
    },
    lmstudio: {
      baseUrl: body.lmstudio?.baseUrl ?? current.lmstudio.baseUrl,
      model: body.lmstudio?.model ?? current.lmstudio.model,
    },
    openrouter: {
      // Only update API key if a full key is provided (not the masked version)
      apiKey:
        body.openrouter?.apiKey && !body.openrouter.apiKey.startsWith("...")
          ? body.openrouter.apiKey
          : current.openrouter.apiKey,
      model: body.openrouter?.model ?? current.openrouter.model,
    },
  };

  saveLLMConfig(updated);
  return NextResponse.json({ ok: true, backend: updated.backend });
}
