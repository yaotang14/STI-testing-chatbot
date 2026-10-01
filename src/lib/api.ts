import type { AppSettings, AppStatus, Session, SessionSummary } from "./types";

const MODEL = "deepseek-flash";
const STORE_KEY = "yao-tang-chat-v1";
const WEB_HISTORY = "浏览器本机存储（可导出 Markdown 文件）";

type Store = {
  apiKey: string;
  mockMode: boolean;
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
  return { apiKey: "", mockMode: false, sessions: {} };
}

function readStore(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as Store;
    return {
      apiKey: parsed.apiKey ?? "",
      mockMode: Boolean(parsed.mockMode),
      sessions: parsed.sessions ?? {},
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
  return oneLine.length > 24 ? `${oneLine.slice(0, 24)}…` : oneLine || "未命名对话";
}

function sessionToMarkdown(session: Session): string {
  const lines = [
    `# 聊天记录：${session.title}`,
    "",
    `- 会话编号：${session.id}`,
    `- 模型：${session.model}`,
    `- 创建时间：${session.createdAt}`,
    `- 更新时间：${session.updatedAt}`,
    "",
    "---",
    "",
  ];
  for (const msg of session.messages) {
    const who =
      msg.role === "user" ? "用户" : msg.role === "assistant" ? "助手" : msg.role;
    lines.push(`## ${who}（${msg.createdAt}）`, "", msg.content.trim(), "");
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

function webStatus(): AppStatus {
  const store = readStore();
  return {
    hasApiKey: Boolean(store.apiKey.trim()),
    mockMode: store.mockMode,
    model: MODEL,
    historyDir: WEB_HISTORY,
    keySource: store.apiKey.trim() ? "file" : "none",
  };
}

async function webInvoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const store = readStore();

  switch (cmd) {
    case "get_status":
      return webStatus() as T;
    case "get_settings": {
      const key = store.apiKey.trim();
      const masked =
        key.length === 0
          ? ""
          : key.length <= 8
            ? "********"
            : `${key.slice(0, 4)}…${key.slice(-4)}`;
      return { apiKey: masked, mockMode: store.mockMode } as T;
    }
    case "save_settings": {
      const incoming = String(args.apiKey ?? args.api_key ?? "");
      const looksMasked = incoming.includes("…") || incoming.includes("****");
      if (!looksMasked) store.apiKey = incoming.trim();
      store.mockMode = Boolean(args.mockMode ?? args.mock_mode);
      writeStore(store);
      return webStatus() as T;
    }
    case "list_sessions": {
      const items: SessionSummary[] = Object.values(store.sessions).map((s) => ({
        id: s.id,
        title: s.title,
        updatedAt: s.updatedAt,
        messageCount: s.messages.length,
      }));
      items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return items as T;
    }
    case "create_session": {
      const session: Session = {
        id: uid(),
        title: "新对话",
        createdAt: nowIso(),
        updatedAt: nowIso(),
        model: MODEL,
        messages: [],
      };
      store.sessions[session.id] = session;
      writeStore(store);
      return session as T;
    }
    case "load_session": {
      const session = store.sessions[String(args.id)];
      if (!session) throw new Error("找不到该聊天记录");
      return session as T;
    }
    case "delete_session": {
      delete store.sessions[String(args.id)];
      writeStore(store);
      return undefined as T;
    }
    case "export_session": {
      const session = store.sessions[String(args.id)];
      if (!session) throw new Error("找不到该聊天记录");
      const name = `聊天记录_${session.title.replace(/[^\w\u4e00-\u9fa5]+/g, "_").slice(0, 24)}.md`;
      downloadText(name, sessionToMarkdown(session));
      return name as T;
    }
    case "export_all_sessions": {
      const all = Object.values(store.sessions).sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      );
      const body =
        "# 全部聊天记录\n\n" +
        (all.length === 0
          ? "（暂无记录）\n"
          : all.map(sessionToMarkdown).join("\n\n"));
      const name = `全部聊天记录_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.md`;
      downloadText(name, body);
      return name as T;
    }
    case "open_history_dir":
      throw new Error("浏览器预览无法打开系统目录，请使用「导出」下载聊天记录。");
    case "send_message": {
      const id = String(args.sessionId ?? args.session_id);
      const content = String(args.content ?? "").trim();
      if (!content) throw new Error("请输入要发送的内容");
      const session = store.sessions[id];
      if (!session) throw new Error("找不到该聊天记录");
      if (session.messages.length === 0) session.title = titleFrom(content);
      session.messages.push({
        id: uid(),
        role: "user",
        content,
        createdAt: nowIso(),
      });
      session.updatedAt = nowIso();
      writeStore(store);

      let reply: string;
      if (store.mockMode) {
        reply = `（本地演示，未调用 DeepSeek）我已记下你的话：「${content.slice(0, 80)}」。这条回复会写入本机聊天记录，可导出查看。`;
      } else {
        const key = store.apiKey.trim();
        if (!key) {
          throw new Error(
            "尚未配置 DeepSeek API 密钥。请在设置中填写，或设置环境变量 DEEPSEEK_API_KEY。也可以打开「本地演示」在没有密钥时试用界面和聊天记录。",
          );
        }
        reply = await callDeepSeek(key, session.messages);
      }

      session.messages.push({
        id: uid(),
        role: "assistant",
        content: reply,
        createdAt: nowIso(),
      });
      session.updatedAt = nowIso();
      writeStore(store);
      return session as T;
    }
    default:
      throw new Error(`未知命令：${cmd}`);
  }
}

async function callDeepSeek(
  apiKey: string,
  history: Session["messages"],
): Promise<string> {
  const messages = [
    {
      role: "system",
      content: "你是姚唐的中文助手，回答简洁、准确、口语自然。",
    },
    ...history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content })),
  ];

  const res = await fetch("/deepseek-api/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      stream: false,
      thinking: { type: "disabled" },
    }),
  });

  const data = (await res.json()) as {
    error?: { message?: string };
    choices?: { message?: { content?: string } }[];
  };
  if (data.error?.message) throw new Error(data.error.message);
  if (!res.ok) throw new Error(`DeepSeek 请求失败（HTTP ${res.status}）`);
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("模型没有返回文本");
  return text;
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
  saveSettings: (apiKey: string, mockMode: boolean) =>
    invokeCmd<AppStatus>("save_settings", { apiKey, mockMode, api_key: apiKey, mock_mode: mockMode }),
  listSessions: () => invokeCmd<SessionSummary[]>("list_sessions"),
  createSession: () => invokeCmd<Session>("create_session"),
  loadSession: (id: string) => invokeCmd<Session>("load_session", { id }),
  deleteSession: (id: string) => invokeCmd<void>("delete_session", { id }),
  exportSession: (id: string) => invokeCmd<string>("export_session", { id }),
  exportAll: () => invokeCmd<string>("export_all_sessions"),
  openHistoryDir: () => invokeCmd<void>("open_history_dir"),
  sendMessage: (sessionId: string, content: string) =>
    invokeCmd<Session>("send_message", { sessionId, session_id: sessionId, content }),
  isTauri,
};
