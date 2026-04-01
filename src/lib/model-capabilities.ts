/**
 * Model capability service.
 * Fetches and caches model metadata from OpenRouter's /models API.
 * Used to determine: instruct type, supported parameters, context length.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), ".viveka-data");
const CACHE_FILE = join(DATA_DIR, "model-capabilities-cache.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface ModelCapabilities {
  id: string;
  name: string;
  contextLength: number;
  instructType: string | null;  // null = base model or raw chat
  supportedParameters: string[];
  isBaseModel: boolean;
  modality: string;
  pricing: {
    prompt: string;
    completion: string;
  };
}

interface CacheEntry {
  fetchedAt: number;
  models: Record<string, ModelCapabilities>;
}

// Known base models (manual override for models where instruct_type is ambiguous)
const KNOWN_BASE_MODELS = new Set([
  "deepseek/deepseek-v3.1-base",
  "meta-llama/llama-3.1-405b",
  "meta-llama/llama-3.1-70b",
  "meta-llama/llama-3.1-8b",
  "mistralai/mistral-7b",
]);

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadCache(): CacheEntry | null {
  ensureDir();
  try {
    const data = JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
    if (Date.now() - data.fetchedAt < CACHE_TTL_MS) {
      return data;
    }
  } catch {
    // No cache or expired
  }
  return null;
}

function saveCache(entry: CacheEntry): void {
  ensureDir();
  writeFileSync(CACHE_FILE, JSON.stringify(entry), "utf-8");
}

async function fetchFromOpenRouter(): Promise<Record<string, ModelCapabilities>> {
  console.log("[model-capabilities] fetching from OpenRouter API...");
  const res = await fetch("https://openrouter.ai/api/v1/models");
  if (!res.ok) {
    throw new Error(`OpenRouter models API error: ${res.status}`);
  }
  const data = await res.json();
  const models: Record<string, ModelCapabilities> = {};

  for (const m of data.data || []) {
    const id = m.id;
    const instructType = m.architecture?.instruct_type ?? null;
    const isBase = KNOWN_BASE_MODELS.has(id) ||
      id.toLowerCase().includes("-base") ||
      (instructType === null && !id.includes("instruct") && !id.includes("chat") && !id.includes("turbo"));

    models[id] = {
      id,
      name: m.name || id,
      contextLength: m.context_length || 4096,
      instructType,
      supportedParameters: m.supported_parameters || [],
      isBaseModel: isBase,
      modality: m.architecture?.modality || "text->text",
      pricing: {
        prompt: m.pricing?.prompt || "0",
        completion: m.pricing?.completion || "0",
      },
    };
  }

  console.log(`[model-capabilities] cached ${Object.keys(models).length} models`);
  return models;
}

let _cache: CacheEntry | null = null;

/**
 * Get capabilities for all models. Cached for 24 hours.
 */
export async function getAllModels(): Promise<Record<string, ModelCapabilities>> {
  // In-memory cache first
  if (_cache && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) {
    return _cache.models;
  }
  // Disk cache
  _cache = loadCache();
  if (_cache) return _cache.models;
  // Fetch fresh
  try {
    const models = await fetchFromOpenRouter();
    _cache = { fetchedAt: Date.now(), models };
    saveCache(_cache);
    return models;
  } catch (err) {
    console.error("[model-capabilities] fetch failed:", err);
    return {};
  }
}

/**
 * Get capabilities for a specific model.
 */
export async function getModelCapabilities(modelId: string): Promise<ModelCapabilities | null> {
  const all = await getAllModels();
  return all[modelId] ?? null;
}

/**
 * Check if a model is a base model (not instruct-tuned).
 */
export async function isBaseModel(modelId: string): Promise<boolean> {
  if (KNOWN_BASE_MODELS.has(modelId)) return true;
  if (modelId.toLowerCase().includes("-base")) return true;
  const caps = await getModelCapabilities(modelId);
  return caps?.isBaseModel ?? false;
}

/**
 * Check if a model supports specific parameters.
 */
export async function supportsParameters(
  modelId: string,
  params: string[]
): Promise<boolean> {
  const caps = await getModelCapabilities(modelId);
  if (!caps || caps.supportedParameters.length === 0) {
    // Unknown model — assume it supports standard params
    return true;
  }
  return params.every((p) => caps.supportedParameters.includes(p));
}

/**
 * Get the prompt format for a model.
 * Base models get raw text. Instruct models get chat messages.
 */
export type PromptFormat = "chat-messages" | "raw-text";

export async function getPromptFormat(modelId: string): Promise<PromptFormat> {
  if (await isBaseModel(modelId)) return "raw-text";
  return "chat-messages";
}
