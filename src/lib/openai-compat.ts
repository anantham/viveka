/**
 * OpenAI-compatible API adapter for Ollama and OpenRouter.
 * Drop-in replacement for Claude Code subprocess calls.
 */
import type { ClaudeResponse, UsageInfo } from "./claude";
import { loadLLMConfig } from "./llm-config";

function log(stage: string, detail: string, ms?: number) {
  const ts = new Date().toISOString().slice(11, 23);
  const timing = ms !== undefined ? ` (${ms}ms)` : "";
  console.log(`[LLM ${ts}] ${stage}: ${detail}${timing}`);
}

export interface OpenAICompatConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * Returns config if the active backend is "ollama" or "openrouter".
 * Checks runtime config (UI-togglable) first, falls back to env vars.
 * Returns null to fall through to Claude Code subprocess.
 */
export function getOpenAICompatConfig(): OpenAICompatConfig | null {
  // Runtime config from UI takes precedence
  const runtimeConfig = loadLLMConfig();
  const backend = runtimeConfig.backend !== "claude"
    ? runtimeConfig.backend
    : process.env.VIVEKA_LLM_BACKEND;

  log("config", `backend=${backend ?? "claude"}, runtime=${runtimeConfig.backend}`);

  if (backend === "ollama") {
    return {
      baseUrl: runtimeConfig.ollama.baseUrl || process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1",
      apiKey: "ollama",
      model: runtimeConfig.ollama.model || process.env.OLLAMA_MODEL || "llama3.2:3b",
    };
  }

  if (backend === "lmstudio") {
    return {
      baseUrl: runtimeConfig.lmstudio.baseUrl || "http://localhost:1234/v1",
      apiKey: "lm-studio",
      model: runtimeConfig.lmstudio.model || "default",
    };
  }

  if (backend === "openrouter") {
    const apiKey = runtimeConfig.openrouter.apiKey || process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OpenRouter API key is required. Set it in Settings or OPENROUTER_API_KEY env var.");
    }
    return {
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey,
      model: runtimeConfig.openrouter.model || process.env.OPENROUTER_MODEL || "meta-llama/llama-3.1-8b-instant",
    };
  }

  return null;
}

/**
 * Non-streaming query to an OpenAI-compatible endpoint.
 * Returns the same ClaudeResponse shape so callers don't need to change.
 */
export async function queryOpenAICompat(
  prompt: string,
  systemPrompt: string,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>,
  config: OpenAICompatConfig
): Promise<ClaudeResponse> {
  const t0 = Date.now();
  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...conversationHistory,
    { role: "user" as const, content: prompt },
  ];

  const msgCount = messages.length;
  const promptChars = messages.reduce((s, m) => s + m.content.length, 0);
  log("request", `${config.model} via ${config.baseUrl} | ${msgCount} msgs, ~${promptChars} chars`);

  const t1 = Date.now();
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: false,
    }),
  });
  const t2 = Date.now();
  log("fetch", `HTTP ${response.status}`, t2 - t1);

  if (!response.ok) {
    const errorText = await response.text();
    log("error", `${response.status}: ${errorText.slice(0, 200)}`);
    throw new Error(
      `LLM API error (${response.status}): ${errorText}`
    );
  }

  const data = await response.json();
  const t3 = Date.now();
  const text = data.choices?.[0]?.message?.content?.trim() || "";

  const usage: UsageInfo | null = data.usage
    ? {
        inputTokens: data.usage.prompt_tokens ?? 0,
        outputTokens: data.usage.completion_tokens ?? 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        costUSD: 0,
      }
    : null;

  log("response", `${text.length} chars | in=${usage?.inputTokens ?? "?"} out=${usage?.outputTokens ?? "?"} tokens`, t3 - t0);

  return { text, raw: JSON.stringify(data), rateLimit: null, usage };
}

/**
 * Streaming query to an OpenAI-compatible endpoint.
 * Yields text deltas, matching streamClaudeCode's interface.
 */
export async function* streamOpenAICompat(
  prompt: string,
  systemPrompt: string,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>,
  config: OpenAICompatConfig
): AsyncGenerator<string> {
  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...conversationHistory,
    { role: "user" as const, content: prompt },
  ];

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `LLM API error (${response.status}): ${errorText}`
    );
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body from LLM API");

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") return;

        try {
          const parsed = JSON.parse(payload);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // skip unparseable SSE chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
