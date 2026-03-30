/**
 * Runtime LLM backend configuration.
 * Persists to .viveka-data/llm-config.json so it survives hot reloads.
 * UI can toggle without editing .env.local.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), ".viveka-data");
const CONFIG_FILE = join(DATA_DIR, "llm-config.json");

export type LLMBackend = "claude" | "ollama" | "lmstudio" | "openrouter";

export interface LLMConfig {
  backend: LLMBackend;
  ollama: {
    baseUrl: string;
    model: string;
  };
  lmstudio: {
    baseUrl: string;
    model: string;
  };
  openrouter: {
    apiKey: string;
    model: string;
  };
}

const DEFAULT_CONFIG: LLMConfig = {
  backend: "claude",
  ollama: {
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.2:3b",
  },
  lmstudio: {
    baseUrl: "http://localhost:1234/v1",
    model: "default",
  },
  openrouter: {
    apiKey: "",
    model: "meta-llama/llama-3.1-8b-instant",
  },
};

function ensureDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadLLMConfig(): LLMConfig {
  ensureDir();
  try {
    const data = readFileSync(CONFIG_FILE, "utf-8");
    const saved = JSON.parse(data);
    return { ...DEFAULT_CONFIG, ...saved };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveLLMConfig(config: LLMConfig): void {
  ensureDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}
