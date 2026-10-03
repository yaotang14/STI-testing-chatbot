import type { ProviderId } from "./types";

export type ModelPresetId =
  | "deepseek"
  | "deepseek-pro"
  | "chatgpt"
  | "gpt-6-luna"
  | "custom";

export type ModelPreset = {
  id: ModelPresetId;
  label: string;
  provider: ProviderId;
  modelId: string;
};

export const MODEL_PRESETS: ModelPreset[] = [
  { id: "deepseek", label: "deepseek-flash", provider: "deepseek", modelId: "deepseek-flash" },
  { id: "deepseek-pro", label: "deepseek-v4-pro", provider: "deepseek", modelId: "deepseek-v4-pro" },
  { id: "chatgpt", label: "gpt-4o-mini", provider: "openai", modelId: "gpt-4o-mini" },
  { id: "gpt-6-luna", label: "gpt-6-luna", provider: "openai", modelId: "gpt-6-luna" },
  { id: "custom", label: "Custom", provider: "openai", modelId: "" },
];

export const DEFAULT_PRESET: ModelPresetId = "deepseek";
export const DEFAULT_MODEL_ID = "deepseek-flash";

export function normalizePreset(value: unknown): ModelPresetId {
  const id = String(value ?? "");
  return MODEL_PRESETS.some((p) => p.id === id) ? (id as ModelPresetId) : DEFAULT_PRESET;
}

export function presetById(id: ModelPresetId): ModelPreset {
  return MODEL_PRESETS.find((p) => p.id === id) ?? MODEL_PRESETS[0];
}

export function inferProvider(modelId: string, fallback: ProviderId = "openai"): ProviderId {
  const id = modelId.trim().toLowerCase();
  if (id.startsWith("deepseek")) return "deepseek";
  if (id.startsWith("gpt-") || id.startsWith("chatgpt") || id.startsWith("o1") || id.startsWith("o3")) {
    return "openai";
  }
  return fallback;
}

export function resolveModel(
  preset: ModelPresetId,
  customModelId: string,
  customProvider: ProviderId,
): { provider: ProviderId; modelId: string; label: string } {
  if (preset === "custom") {
    const modelId = customModelId.trim();
    const provider = inferProvider(modelId, customProvider);
    return {
      provider,
      modelId,
      label: modelId || "Custom",
    };
  }
  const p = presetById(preset);
  return { provider: p.provider, modelId: p.modelId, label: p.label };
}

export function modelDisplayName(modelId?: string, _provider?: string): string {
  const id = modelId?.trim();
  if (!id) return "";
  return id;
}

export function presetFromModel(modelId: string, provider: ProviderId): ModelPresetId {
  const match = MODEL_PRESETS.find((p) => p.id !== "custom" && p.modelId === modelId);
  if (match) return match.id;
  if (!modelId) return provider === "openai" ? "chatgpt" : "deepseek";
  const defaults = provider === "openai" ? "gpt-4o-mini" : "deepseek-flash";
  if (modelId === defaults) return provider === "openai" ? "chatgpt" : "deepseek";
  return "custom";
}
