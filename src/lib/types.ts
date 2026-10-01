export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system" | string;
  content: string;
  createdAt: string;
};

export type Session = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  messages: ChatMessage[];
};

export type SessionSummary = {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
};

export type AppStatus = {
  hasApiKey: boolean;
  mockMode: boolean;
  model: string;
  historyDir: string;
  keySource: string;
};

export type AppSettings = {
  apiKey: string;
  mockMode: boolean;
};
