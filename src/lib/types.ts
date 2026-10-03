export type ProviderId = "deepseek" | "openai";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system" | string;
  content: string;
  createdAt: string;
  provider?: string;
  model?: string;
};

export type Session = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  provider: string;
  model: string;
  messages: ChatMessage[];
};

export type SessionSummary = {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
  provider: string;
  model: string;
};

export type AppStatus = {
  hasDeepseekKey: boolean;
  hasOpenaiKey: boolean;
  mockMode: boolean;
  provider: ProviderId;
  modelPreset: string;
  modelId: string;
  customModelId: string;
  historyDir: string;
};

export type AppSettings = {
  deepseekApiKey: string;
  openaiApiKey: string;
  mockMode: boolean;
  provider: ProviderId;
  modelPreset: string;
  modelId: string;
  customModelId: string;
};

export function providerLabel(provider: string): string {
  return provider === "openai" ? "OpenAI" : "DeepSeek";
}
