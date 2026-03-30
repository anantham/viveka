import { spawn } from "child_process";
import {
  getOpenAICompatConfig,
  queryOpenAICompat,
  streamOpenAICompat,
} from "./openai-compat";

export interface RateLimitInfo {
  status: string;
  resetsAt: number; // unix timestamp
  rateLimitType: string; // "five_hour", etc.
  percentUsed?: number;
}

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUSD: number;
}

export interface ClaudeResponse {
  text: string;
  raw: string;
  rateLimit: RateLimitInfo | null;
  usage: UsageInfo | null;
}

/**
 * Calls claude -p with a system prompt and returns the full response text.
 * Uses the locally authenticated Claude Code CLI (Max plan OAuth).
 */
export async function queryClaudeCode(
  prompt: string,
  systemPrompt: string,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>,
  options?: { model?: string; noTools?: boolean }
): Promise<ClaudeResponse> {
  // Route to OpenAI-compatible backend if configured
  const compatConfig = getOpenAICompatConfig();
  if (compatConfig) {
    return queryOpenAICompat(prompt, systemPrompt, conversationHistory, compatConfig);
  }

  // Build the full prompt with conversation history
  let fullPrompt = "";
  for (const msg of conversationHistory) {
    const label = msg.role === "user" ? "User" : "Assistant";
    fullPrompt += `${label}: ${msg.content}\n\n`;
  }
  fullPrompt += `User: ${prompt}`;

  const args = [
    "-p",
    fullPrompt,
    "--system-prompt",
    systemPrompt,
    "--output-format",
    "json",
    "--max-turns",
    "1",
    "--no-session-persistence",
    "--disable-slash-commands",
    "--setting-sources",
    "",
  ];

  if (options?.model) {
    args.push("--model", options.model);
  }

  if (options?.noTools) {
    args.push("--tools", "");
  }

  return new Promise<ClaudeResponse>((resolve, reject) => {
    const proc = spawn("claude", args, {
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`claude exited with code ${code}: ${stderr}`));
        return;
      }

      // --output-format json returns a JSON array of events.
      // Extract: result text, rate_limit_event, usage from result entry.
      try {
        const parsed = JSON.parse(stdout);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const events: any[] = Array.isArray(parsed) ? parsed : [parsed];

        let text = "";
        let rateLimit: RateLimitInfo | null = null;
        let usage: UsageInfo | null = null;

        for (const entry of events) {
          // Result text
          if (entry.type === "result" && typeof entry.result === "string") {
            text = entry.result.trim();
            // Usage from result entry
            if (entry.usage) {
              usage = {
                inputTokens: entry.usage.input_tokens ?? 0,
                outputTokens: entry.usage.output_tokens ?? 0,
                cacheReadInputTokens: entry.usage.cache_read_input_tokens ?? 0,
                cacheCreationInputTokens: entry.usage.cache_creation_input_tokens ?? 0,
                costUSD: entry.total_cost_usd ?? 0,
              };
            }
          }
          // Rate limit info
          if (entry.type === "rate_limit_event" && entry.rate_limit_info) {
            const rli = entry.rate_limit_info;
            rateLimit = {
              status: rli.status,
              resetsAt: rli.resetsAt,
              rateLimitType: rli.rateLimitType,
              percentUsed: rli.percentUsed,
            };
          }
          // Fallback text from assistant messages
          if (!text && entry.type === "assistant" && entry.message?.content) {
            for (const block of entry.message.content) {
              if (block.type === "text") text += block.text;
            }
          }
        }

        resolve({ text: text.trim() || stdout.trim(), raw: stdout, rateLimit, usage });
      } catch {
        // Not valid JSON — try NDJSON
        const lines = stdout.split("\n").filter((l: string) => l.trim());
        let resultText = "";
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj.type === "result" && typeof obj.result === "string") {
              resultText = obj.result.trim();
              break;
            }
          } catch {
            // skip
          }
        }
        resolve({ text: resultText || stdout.trim(), raw: stdout, rateLimit: null, usage: null });
      }
    });

    proc.on("error", (err: Error) => {
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });
  });
}

/**
 * Streams claude -p output line by line via stream-json format.
 */
export async function* streamClaudeCode(
  prompt: string,
  systemPrompt: string,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>
): AsyncGenerator<string> {
  // Route to OpenAI-compatible backend if configured
  const compatConfig = getOpenAICompatConfig();
  if (compatConfig) {
    yield* streamOpenAICompat(prompt, systemPrompt, conversationHistory, compatConfig);
    return;
  }

  let fullPrompt = "";
  for (const msg of conversationHistory) {
    const label = msg.role === "user" ? "User" : "Assistant";
    fullPrompt += `${label}: ${msg.content}\n\n`;
  }
  fullPrompt += `User: ${prompt}`;

  const args = [
    "-p",
    fullPrompt,
    "--system-prompt",
    systemPrompt,
    "--output-format",
    "stream-json",
    "--max-turns",
    "1",
    "--no-session-persistence",
    "--disable-slash-commands",
  ];

  const proc = spawn("claude", args, {
    env: { ...process.env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let buffer = "";

  for await (const chunk of proc.stdout) {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "assistant" && parsed.message?.content) {
          for (const block of parsed.message.content) {
            if (block.type === "text") {
              yield block.text;
            }
          }
        }
      } catch {
        // skip unparseable lines
      }
    }
  }
}
