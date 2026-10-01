import type { AppSettings, AppStatus, ProviderId, Session, SessionSummary } from "./types";
import { providerLabel } from "./types";

const DEEPSEEK_MODEL = "deepseek-flash";
const OPENAI_MODEL = "gpt-4o-mini";
const STORE_KEY = "yao-tang-chat-v2";
const WEB_HISTORY = "Browser storage (export as Markdown)";

type Store = {
  deepseekApiKey: string;
  openaiApiKey: string;
  mockMode: boolean;
  provider: ProviderId;
  sessions: Record<string, Session>;
};

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function nowIso(): string {
  return new Date().toISOString();
}

function uid(): string {
  return crypto.randomUUID();
}

function emptyStore(): Store {
  return {
    deepseekApiKey: "",
    openaiApiKey: "",
    mockMode: false,
    provider: "deepseek",
    sessions: {},
  };
}

function normalizeProvider(value: unknown): ProviderId {
  return value === "openai" ? "openai" : "deepseek";
}

function modelFor(provider: ProviderId): string {
  return provider === "openai" ? OPENAI_MODEL : DEEPSEEK_MODEL;
}

function migrateSession(raw: Session): Session {
  const provider = normalizeProvider(raw.provider);
  return {
    ...raw,
    provider,
    model: raw.model || modelFor(provider),
    messages: raw.messages ?? [],
  };
}

function readStore(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY) ?? localStorage.getItem("yao-tang-chat-v1");
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as Partial<Store> & { apiKey?: string };
    const sessions: Record<string, Session> = {};
    for (const [id, session] of Object.entries(parsed.sessions ?? {})) {
      sessions[id] = migrateSession(session);
    }
    return {
      deepseekApiKey: parsed.deepseekApiKey ?? parsed.apiKey ?? "",
      openaiApiKey: parsed.openaiApiKey ?? "",
      mockMode: Boolean(parsed.mockMode),
      provider: normalizeProvider(parsed.provider),
      sessions,
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(store: Store) {
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

function titleFrom(text: string): string {
  const oneLine = text.trim().replace(/\s+/g, " ");
  return oneLine.length > 24 ? `${oneLine.slice(0, 24)}…` : oneLine || "New chat";
}

function maskKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) return "********";
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

function looksMasked(value: string): boolean {
  return value.includes("…") || value.includes("****");
}

function sessionToMarkdown(session: Session): string {
  const provider = providerLabel(session.provider);
  const lines = [
    `# Chat transcript: ${session.title}`,
    "",
    `- Session ID: ${session.id}`,
    `- Provider: ${provider}`,
    `- Created: ${session.createdAt}`,
    `- Updated: ${session.updatedAt}`,
    "",
    "---",
    "",
  ];
  for (const msg of session.messages) {
    const who = msg.role === "user" ? "You" : msg.role === "assistant" ? "Assistant" : msg.role;
    const via = msg.provider ? ` · ${providerLabel(msg.provider)}` : "";
    lines.push(`## ${who}${via} (${msg.createdAt})`, "", msg.content.trim(), "");
  }
  return lines.join("\n");
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function webStatus(store = readStore()): AppStatus {
  return {
    hasDeepseekKey: Boolean(store.deepseekApiKey.trim()),
    hasOpenaiKey: Boolean(store.openaiApiKey.trim()),
    mockMode: store.mockMode,
    provider: store.provider,
    historyDir: WEB_HISTORY,
  };
}

function historyMessages(messages: Session["messages"]) {
  return [
    {
      role: "system",
      content: "You are a helpful assistant. Answer clearly and concisely.",
    },
    ...messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content })),
  ];
}

async function callProvider(
  provider: ProviderId,
  apiKey: string,
  history: Session["messages"],
): Promise<string> {
  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        apiKey,
        messages: historyMessages(history),
      }),
    });
  } catch {
    throw new Error(
      `Could not reach ${providerLabel(provider)}. Use this app through the running local server (npm run dev) or the desktop app, then try again.`,
    );
  }

  let data: {
    error?: { message?: string };
    choices?: { message?: { content?: string } }[];
  };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    throw new Error(`${providerLabel(provider)} returned an unreadable response.`);
  }
  if (data.error?.message) throw new Error(data.error.message);
  if (!res.ok) throw new Error(`${providerLabel(provider)} request failed (HTTP ${res.status})`);
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("The model returned no text.");
  return text;
}

async function webInvoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const store = readStore();

  switch (cmd) {
    case "get_status":
      return webStatus(store) as T;
    case "get_settings":
      return {
        deepseekApiKey: maskKey(store.deepseekApiKey),
        openaiApiKey: maskKey(store.openaiApiKey),
        mockMode: store.mockMode,
        provider: store.provider,
      } as T;
    case "save_settings": {
      const deepseek = String(args.deepseekApiKey ?? args.deepseek_api_key ?? "");
      const openai = String(args.openaiApiKey ?? args.openai_api_key ?? "");
      if (!looksMasked(deepseek)) store.deepseekApiKey = deepseek.trim();
      if (!looksMasked(openai)) store.openaiApiKey = openai.trim();
      store.mockMode = Boolean(args.mockMode ?? args.mock_mode);
      store.provider = normalizeProvider(args.provider);
      writeStore(store);
      return webStatus(store) as T;
    }
    case "list_sessions": {
      const items: SessionSummary[] = Object.values(store.sessions).map((s) => ({
        id: s.id,
        title: s.title,
        updatedAt: s.updatedAt,
        messageCount: s.messages.length,
        provider: s.provider,
      }));
      items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return items as T;
    }
    case "create_session": {
      const provider = normalizeProvider(args.provider ?? store.provider);
      const session: Session = {
        id: uid(),
        title: "New chat",
        createdAt: nowIso(),
        updatedAt: nowIso(),
        provider,
        model: modelFor(provider),
        messages: [],
      };
      store.sessions[session.id] = session;
      writeStore(store);
      return session as T;
    }
    case "load_session": {
      const session = store.sessions[String(args.id)];
      if (!session) throw new Error("Chat transcript not found.");
      return migrateSession(session) as T;
    }
    case "set_session_provider": {
      const session = store.sessions[String(args.id)];
      if (!session) throw new Error("Chat transcript not found.");
      const provider = normalizeProvider(args.provider);
      session.provider = provider;
      session.model = modelFor(provider);
      session.updatedAt = nowIso();
      writeStore(store);
      return session as T;
    }
    case "delete_session": {
      delete store.sessions[String(args.id)];
      writeStore(store);
      return undefined as T;
    }
    case "export_session": {
      const session = store.sessions[String(args.id)];
      if (!session) throw new Error("Chat transcript not found.");
      const name = `transcript_${session.title.replace(/[^\w]+/g, "_").slice(0, 24)}.md`;
      downloadText(name, sessionToMarkdown(session));
      return name as T;
    }
    case "export_all_sessions": {
      const all = Object.values(store.sessions).sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      );
      const body =
        "# All chat transcripts\n\n" +
        (all.length === 0 ? "(No transcripts yet)\n" : all.map(sessionToMarkdown).join("\n\n"));
      const name = `all_transcripts_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.md`;
      downloadText(name, body);
      return name as T;
    }
    case "open_history_dir":
      throw new Error("The browser preview cannot open a system folder. Use Export to download transcripts.");
    case "send_message": {
      const id = String(args.sessionId ?? args.session_id);
      const content = String(args.content ?? "").trim();
      if (!content) throw new Error("Enter a message to send.");
      const session = store.sessions[id];
      if (!session) throw new Error("Chat transcript not found.");
      const provider = normalizeProvider(args.provider ?? session.provider ?? store.provider);
      session.provider = provider;
      session.model = modelFor(provider);
      if (session.messages.length === 0) session.title = titleFrom(content);
      session.messages.push({
        id: uid(),
        role: "user",
        content,
        createdAt: nowIso(),
        provider,
        model: modelFor(provider),
      });
      session.updatedAt = nowIso();
      writeStore(store);

      let reply: string;
      if (store.mockMode) {
        reply = `(Demo mode — ${providerLabel(provider)} was not called.) I saved your message: “${content.slice(0, 80)}”. This reply is stored in the local transcript.`;
      } else {
        const key =
          provider === "openai" ? store.openaiApiKey.trim() : store.deepseekApiKey.trim();
        if (!key) {
          const envName = provider === "openai" ? "OPENAI_API_KEY" : "DEEPSEEK_API_KEY";
          throw new Error(
            `No API key is configured for ${providerLabel(provider)}. Add it in Settings or set ${envName}. You can also enable Demo mode to try the app without a key.`,
          );
        }
        reply = await callProvider(provider, key, session.messages);
      }

      session.messages.push({
        id: uid(),
        role: "assistant",
        content: reply,
        createdAt: nowIso(),
        provider,
        model: modelFor(provider),
      });
      session.updatedAt = nowIso();
      writeStore(store);
      return session as T;
    }
    default:
      throw new Error(`Unknown command: ${cmd}`);
  }
}

async function invokeCmd<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  }
  return webInvoke<T>(cmd, args ?? {});
}

export const api = {
  status: () => invokeCmd<AppStatus>("get_status"),
  settings: () => invokeCmd<AppSettings>("get_settings"),
  saveSettings: (input: {
    deepseekApiKey: string;
    openaiApiKey: string;
    mockMode: boolean;
    provider: ProviderId;
  }) =>
    invokeCmd<AppStatus>("save_settings", {
      ...input,
      deepseek_api_key: input.deepseekApiKey,
      openai_api_key: input.openaiApiKey,
      mock_mode: input.mockMode,
    }),
  listSessions: () => invokeCmd<SessionSummary[]>("list_sessions"),
  createSession: (provider: ProviderId) =>
    invokeCmd<Session>("create_session", { provider }),
  loadSession: (id: string) => invokeCmd<Session>("load_session", { id }),
  setSessionProvider: (id: string, provider: ProviderId) =>
    invokeCmd<Session>("set_session_provider", { id, provider }),
  deleteSession: (id: string) => invokeCmd<void>("delete_session", { id }),
  exportSession: (id: string) => invokeCmd<string>("export_session", { id }),
  exportAll: () => invokeCmd<string>("export_all_sessions"),
  openHistoryDir: () => invokeCmd<void>("open_history_dir"),
  sendMessage: (sessionId: string, content: string, provider: ProviderId) =>
    invokeCmd<Session>("send_message", {
      sessionId,
      session_id: sessionId,
      content,
      provider,
    }),
  isTauri,
};
