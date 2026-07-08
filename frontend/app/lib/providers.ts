"use client";

export type ModelBadge = "recommended" | "best-value" | "open-source";

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  modelId: string;
  costIn: number;
  costOut: number;
  badge?: ModelBadge;
}

export interface CallResult {
  text: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ProviderDef {
  id: string;
  name: string;
  apiKeyKey: string;
  models: ModelInfo[];
  call(
    base64: string,
    apiKey: string,
    modelId: string,
    systemPrompt: string,
  ): Promise<CallResult>;
  fetchModels?(apiKey: string): Promise<ModelInfo[]>;
}

const providerRegistry = new Map<string, ProviderDef>();

export function registerProvider(provider: ProviderDef): void {
  providerRegistry.set(provider.id, provider);
}

export function getProvider(id: string): ProviderDef | undefined {
  return providerRegistry.get(id);
}

export function getAllProviders(): ProviderDef[] {
  return Array.from(providerRegistry.values());
}

export function getAllModels(): ModelInfo[] {
  const all: ModelInfo[] = [];
  for (const p of providerRegistry.values()) {
    all.push(...p.models);
  }
  return all;
}

export function getModelInfo(modelId: string): ModelInfo | undefined {
  for (const p of providerRegistry.values()) {
    const model = p.models.find((m) => m.id === modelId);
    if (model) return model;
  }
  return undefined;
}

export function getModelApiKey(modelId: string): string | null {
  for (const p of providerRegistry.values()) {
    if (p.models.some((m) => m.id === modelId)) {
      return getLocal(p.apiKeyKey);
    }
  }
  return null;
}

export function getProviderApiKey(providerId: string): string | null {
  const p = providerRegistry.get(providerId);
  if (!p) return null;
  return getLocal(p.apiKeyKey);
}

export function getLocal(key: string, fallback = ""): string {
  if (typeof window === "undefined") return fallback;
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

export async function callModel(
  base64: string,
  modelId: string,
  systemPrompt: string,
): Promise<CallResult> {
  for (const p of providerRegistry.values()) {
    const model = p.models.find((m) => m.id === modelId);
    if (model) {
      const apiKey = getLocal(p.apiKeyKey);
      if (!apiKey)
        throw new Error(`API key not configured for ${p.name}`);
      return p.call(base64, apiKey, model.modelId, systemPrompt);
    }
  }
  throw new Error(`Unknown model: ${modelId}`);
}

export async function refreshProviderModels(
  providerId: string,
): Promise<ModelInfo[]> {
  const p = providerRegistry.get(providerId);
  if (!p || !p.fetchModels) return [];
  const apiKey = getLocal(p.apiKeyKey);
  if (!apiKey) return p.models;
  try {
    const models = await p.fetchModels(apiKey);
    p.models = models;
    return models;
  } catch {
    return p.models;
  }
}

// --- Gemini Provider ---

const GEMINI_STATIC_MODELS: ModelInfo[] = [
  {
    id: "gemini-2.0-flash-lite",
    name: "Gemini 2.0 Flash Lite",
    provider: "Google",
    modelId: "gemini-2.0-flash-lite",
    costIn: 0.075,
    costOut: 0.30,
  },
  {
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    provider: "Google",
    modelId: "gemini-2.0-flash",
    costIn: 0.10,
    costOut: 0.40,
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "Google",
    modelId: "gemini-2.5-flash",
    costIn: 0.15,
    costOut: 0.60,
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "Google",
    modelId: "gemini-2.5-pro",
    costIn: 1.25,
    costOut: 5.00,
    badge: "recommended",
  },
];

async function geminiCall(
  base64: string,
  apiKey: string,
  modelId: string,
  systemPrompt: string,
): Promise<CallResult> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: systemPrompt },
              {
                inline_data: {
                  mime_type: "image/jpeg",
                  data: base64.split(",")[1],
                },
              },
            ],
          },
        ],
      }),
    },
  );
  if (res.status === 429)
    throw new Error("Gemini API rate limit exceeded (429).");
  if (!res.ok)
    throw new Error(
      `Gemini error (${res.status}): ${(await res.text()).slice(0, 100)}`,
    );
  const data = await res.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const meta = data?.usageMetadata || {};
  return {
    text,
    usage: {
      promptTokens: meta.promptTokenCount || 0,
      completionTokens: meta.candidatesTokenCount || 0,
      totalTokens: meta.totalTokenCount || 0,
    },
  };
}

interface GeminiModel {
  name: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
}

async function geminiFetchModels(
  apiKey: string,
): Promise<ModelInfo[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
  );
  if (!res.ok) return GEMINI_STATIC_MODELS;
  const data: { models?: GeminiModel[] } = await res.json();
  const models = (data.models || [])
    .filter(
      (m) =>
        m.name?.startsWith("models/gemini-") &&
        m.supportedGenerationMethods?.includes("generateContent"),
    )
    .map((m) => {
      const name = m.name.replace("models/", "");
      return {
        id: name,
        name: m.displayName || name,
        provider: "Google",
        modelId: name,
        costIn: 0,
        costOut: 0,
      };
    });
  return models.length > 0 ? models : GEMINI_STATIC_MODELS;
}

// --- Groq Provider ---

const GROQ_STATIC_MODELS: ModelInfo[] = [
  {
    id: "groq",
    name: "Llama 4 Scout",
    provider: "Groq",
    modelId: "meta-llama/llama-4-scout-17b-16e-instruct",
    costIn: 0,
    costOut: 0,
    badge: "open-source",
  },
];

async function groqCall(
  base64: string,
  apiKey: string,
  modelId: string,
  systemPrompt: string,
): Promise<CallResult> {
  const res = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: systemPrompt },
              { type: "image_url", image_url: { url: base64 } },
            ],
          },
        ],
        max_tokens: 2048,
      }),
    },
  );
  if (res.status === 429)
    throw new Error("Groq API rate limit exceeded (429).");
  if (!res.ok)
    throw new Error(
      `Groq error (${res.status}): ${(await res.text()).slice(0, 100)}`,
    );
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "";
  const usage = data?.usage || {};
  return {
    text,
    usage: {
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || 0,
    },
  };
}

interface GroqModel {
  id: string;
  object: string;
}

async function groqFetchModels(
  apiKey: string,
): Promise<ModelInfo[]> {
  const res = await fetch(
    "https://api.groq.com/openai/v1/models",
    {
      headers: { Authorization: `Bearer ${apiKey}` },
    },
  );
  if (!res.ok) return GROQ_STATIC_MODELS;
  const data: { data?: GroqModel[] } = await res.json();
  const models = (data.data || [])
    .filter(
      (m) =>
        m.id?.includes("llama") ||
        m.id?.includes("gemma") ||
        m.id?.includes("mixtral") ||
        m.id?.includes("deepseek"),
    )
    .map((m) => ({
      id: m.id,
      name: m.id,
      provider: "Groq",
      modelId: m.id,
      costIn: 0,
      costOut: 0,
    }));
  return models.length > 0 ? models : GROQ_STATIC_MODELS;
}

// --- OpenRouter Provider ---

const OPENROUTER_STATIC_MODELS: ModelInfo[] = [
  {
    id: "qwen/qwen2.5-vl-72b-instruct",
    name: "Qwen 2.5 VL 72B Instruct",
    provider: "OpenRouter",
    modelId: "qwen/qwen2.5-vl-72b-instruct",
    costIn: 0,
    costOut: 0,
    badge: "recommended",
  },
  {
    id: "qwen/qwen2.5-vl-32b-instruct",
    name: "Qwen 2.5 VL 32B Instruct",
    provider: "OpenRouter",
    modelId: "qwen/qwen2.5-vl-32b-instruct",
    costIn: 0,
    costOut: 0,
  },
  {
    id: "mistralai/pixtral-large",
    name: "Pixtral Large",
    provider: "OpenRouter",
    modelId: "mistralai/pixtral-large",
    costIn: 0,
    costOut: 0,
  },
  {
    id: "google/gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "OpenRouter",
    modelId: "google/gemini-2.5-flash",
    costIn: 0,
    costOut: 0,
    badge: "recommended",
  },
];

async function openrouterCall(
  base64: string,
  apiKey: string,
  modelId: string,
  systemPrompt: string,
): Promise<CallResult> {
  const res = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://yourapp.com",
        "X-Title": "EduSphere OCR",
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: systemPrompt },
              { type: "image_url", image_url: { url: base64 } },
            ],
          },
        ],
        max_tokens: 2048,
      }),
    },
  );
  if (res.status === 429)
    throw new Error("OpenRouter API rate limit exceeded (429).");
  if (!res.ok)
    throw new Error(
      `OpenRouter error (${res.status}): ${(await res.text()).slice(0, 100)}`,
    );
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "";
  const usage = data?.usage || {};
  return {
    text,
    usage: {
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || 0,
    },
  };
}

interface OpenRouterModel {
  id: string;
}

async function openrouterFetchModels(
  apiKey: string,
): Promise<ModelInfo[]> {
  const res = await fetch(
    "https://openrouter.ai/api/v1/models",
    {
      headers: { Authorization: `Bearer ${apiKey}` },
    },
  );
  if (!res.ok) return OPENROUTER_STATIC_MODELS;
  const data: { data?: OpenRouterModel[] } = await res.json();
  const models = (data.data || [])
    .filter(
      (m) =>
        m.id?.includes("qwen") ||
        m.id?.includes("pixtral") ||
        m.id?.includes("gemini"),
    )
    .map((m) => ({
      id: m.id,
      name: m.id,
      provider: "OpenRouter",
      modelId: m.id,
      costIn: 0,
      costOut: 0,
    }));
  return models.length > 0 ? models : OPENROUTER_STATIC_MODELS;
}

// --- GitHub Models Provider ---

const GITHUB_STATIC_MODELS: ModelInfo[] = [
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "GitHub Models",
    modelId: "gpt-4o",
    costIn: 0,
    costOut: 0,
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "GitHub Models",
    modelId: "gpt-4o-mini",
    costIn: 0,
    costOut: 0,
    badge: "best-value",
  },
  {
    id: "gpt-4-turbo",
    name: "GPT-4 Turbo",
    provider: "GitHub Models",
    modelId: "gpt-4-turbo",
    costIn: 0,
    costOut: 0,
  },
  {
    id: "Phi-3.5-vision-instruct",
    name: "Phi-3.5 Vision Instruct",
    provider: "GitHub Models",
    modelId: "Phi-3.5-vision-instruct",
    costIn: 0,
    costOut: 0,
  },
];

async function githubCall(
  base64: string,
  apiKey: string,
  modelId: string,
  systemPrompt: string,
): Promise<CallResult> {
  const res = await fetch(
    "https://models.inference.ai.azure.com/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: systemPrompt },
              { type: "image_url", image_url: { url: base64 } },
            ],
          },
        ],
        max_tokens: 2048,
      }),
    },
  );
  if (res.status === 429)
    throw new Error("GitHub Models API rate limit exceeded (429).");
  if (!res.ok)
    throw new Error(
      `GitHub Models error (${res.status}): ${(await res.text()).slice(0, 100)}`,
    );
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "";
  const usage = data?.usage || {};
  return {
    text,
    usage: {
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || 0,
    },
  };
}

interface GitHubModel {
  id: string;
}

async function githubFetchModels(
  apiKey: string,
): Promise<ModelInfo[]> {
  const res = await fetch(
    "https://models.inference.ai.azure.com/models",
    {
      headers: { Authorization: `Bearer ${apiKey}` },
    },
  );
  if (!res.ok) return GITHUB_STATIC_MODELS;
  const data: { data?: GitHubModel[] } = await res.json();
  const models = (data.data || [])
    .filter(
      (m) =>
        m.id?.includes("gpt") ||
        m.id?.includes("Phi") ||
        m.id?.includes("Llama") ||
        m.id?.includes("gemini") ||
        m.id?.includes("Mistral") ||
        m.id?.includes("Cohere"),
    )
    .map((m) => ({
      id: m.id,
      name: m.id,
      provider: "GitHub Models",
      modelId: m.id,
      costIn: 0,
      costOut: 0,
    }));
  return models.length > 0 ? models : GITHUB_STATIC_MODELS;
}

// Register default providers
registerProvider({
  id: "google",
  name: "Google",
  apiKeyKey: "gemini_key",
  models: GEMINI_STATIC_MODELS,
  call: geminiCall,
  fetchModels: geminiFetchModels,
});

registerProvider({
  id: "groq",
  name: "Groq",
  apiKeyKey: "groq_key",
  models: GROQ_STATIC_MODELS,
  call: groqCall,
  fetchModels: groqFetchModels,
});

registerProvider({
  id: "openrouter",
  name: "OpenRouter",
  apiKeyKey: "openrouter_key",
  models: OPENROUTER_STATIC_MODELS,
  call: openrouterCall,
  fetchModels: openrouterFetchModels,
});

registerProvider({
  id: "github",
  name: "GitHub Models",
  apiKeyKey: "github_key",
  models: GITHUB_STATIC_MODELS,
  call: githubCall,
  fetchModels: githubFetchModels,
});
