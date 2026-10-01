import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./lib/api";
import type { AppStatus, Session, SessionSummary } from "./lib/types";

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export default function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [current, setCurrent] = useState<Session | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [mockMode, setMockMode] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const booted = useRef(false);

  const refreshList = useCallback(async () => {
    const items = await api.listSessions();
    setSessions(items);
    return items;
  }, []);

  const openSession = useCallback(async (id: string) => {
    const session = await api.loadSession(id);
    setCurrent(session);
    setSendError(null);
    setSidebarOpen(false);
  }, []);

  const startNew = useCallback(async () => {
    const session = await api.createSession();
    setCurrent(session);
    await refreshList();
    setSidebarOpen(false);
  }, [refreshList]);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      try {
        const s = await api.status();
        setStatus(s);
        setMockMode(s.mockMode);
        const settings = await api.settings();
        setApiKeyInput(settings.apiKey);
        const items = await refreshList();
        if (items[0]) await openSession(items[0].id);
        else await startNew();
      } catch (err) {
        setBootError(err instanceof Error ? err.message : "启动失败");
      }
    })();
  }, [openSession, refreshList, startNew]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [current?.messages.length, loading]);

  async function onSend(event?: FormEvent) {
    event?.preventDefault();
    if (!current || loading) return;
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    setSendError(null);
    setLoading(true);
    const optimistic: Session = {
      ...current,
      messages: [
        ...current.messages,
        {
          id: "pending-user",
          role: "user",
          content: text,
          createdAt: new Date().toISOString(),
        },
      ],
    };
    setCurrent(optimistic);
    try {
      const updated = await api.sendMessage(current.id, text);
      setCurrent(updated);
      await refreshList();
      const s = await api.status();
      setStatus(s);
    } catch (err) {
      setCurrent(current);
      setDraft(text);
      setSendError(err instanceof Error ? err.message : "发送失败");
    } finally {
      setLoading(false);
    }
  }

  async function onSaveSettings(event: FormEvent) {
    event.preventDefault();
    setSavingSettings(true);
    setSendError(null);
    try {
      const next = await api.saveSettings(apiKeyInput, mockMode);
      setStatus(next);
      const settings = await api.settings();
      setApiKeyInput(settings.apiKey);
      setNotice(mockMode ? "已打开本地演示，发送消息不会调用接口。" : "设置已保存。");
      setSettingsOpen(false);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSavingSettings(false);
    }
  }

  async function onDelete(id: string) {
    await api.deleteSession(id);
    const items = await refreshList();
    if (current?.id === id) {
      if (items[0]) await openSession(items[0].id);
      else await startNew();
    }
  }

  async function onExport(id: string) {
    try {
      const path = await api.exportSession(id);
      setNotice(api.isTauri() ? `已导出到 ${path}` : `已开始下载 ${path}`);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "导出失败");
    }
  }

  async function onExportAll() {
    try {
      const path = await api.exportAll();
      setNotice(api.isTauri() ? `已导出到 ${path}` : `已开始下载 ${path}`);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "导出失败");
    }
  }

  async function onOpenDir() {
    try {
      await api.openHistoryDir();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "无法打开目录");
    }
  }

  const emptyChat = !current || current.messages.length === 0;
  const keyHint = useMemo(() => {
    if (!status) return "";
    if (status.mockMode) return "本地演示中";
    if (status.hasApiKey) return `已配置密钥（${status.model}）`;
    return "未配置密钥";
  }, [status]);

  if (bootError) {
    return (
      <div className="boot-error">
        <h1>无法启动</h1>
        <p>{bootError}</p>
      </div>
    );
  }

  if (!status || !current) {
    return (
      <div className="boot-loading" role="status">
        正在载入聊天记录…
      </div>
    );
  }

  return (
    <div className="shell">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brand">
          <div>
            <p className="eyebrow">姚唐</p>
            <h1>DeepSeek 聊天</h1>
          </div>
          <button className="ghost" type="button" onClick={startNew}>
            新对话
          </button>
        </div>
        <p className="path-hint" title={status.historyDir}>
          记录目录：{status.historyDir}
        </p>
        <nav className="session-list" aria-label="聊天记录">
          {sessions.length === 0 ? (
            <p className="muted">还没有保存的对话。</p>
          ) : (
            sessions.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === current.id ? "session active" : "session"}
                onClick={() => openSession(item.id)}
              >
                <span className="session-title">{item.title}</span>
                <span className="session-meta">
                  {item.messageCount} 条 · {formatTime(item.updatedAt)}
                </span>
              </button>
            ))
          )}
        </nav>
        <div className="sidebar-actions">
          <button type="button" onClick={() => setHistoryOpen(true)}>
            查看聊天记录
          </button>
          <button type="button" onClick={onExportAll}>
            导出全部
          </button>
          <button type="button" onClick={() => setSettingsOpen(true)}>
            设置
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button
            className="menu"
            type="button"
            aria-label="打开会话列表"
            onClick={() => setSidebarOpen((v) => !v)}
          >
            菜单
          </button>
          <div>
            <h2>{current.title}</h2>
            <p>
              模型 {status.model} · {keyHint}
            </p>
          </div>
          <div className="top-actions">
            <button type="button" onClick={() => onExport(current.id)}>
              导出本段
            </button>
            <button type="button" className="danger" onClick={() => onDelete(current.id)}>
              删除
            </button>
          </div>
        </header>

        {notice ? (
          <div className="banner ok" role="status">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)}>
              关闭
            </button>
          </div>
        ) : null}
        {sendError ? (
          <div className="banner err" role="alert">
            <span>{sendError}</span>
            <button type="button" onClick={() => setSendError(null)}>
              关闭
            </button>
          </div>
        ) : null}

        <div className="messages" ref={scroller}>
          {emptyChat ? (
            <div className="empty">
              <p>还没有消息。</p>
              <p>写一句中文，开始和 DeepSeek Flash 对话。每轮都会写入本机聊天记录。</p>
            </div>
          ) : (
            current.messages.map((msg) => (
              <article key={msg.id} className={`bubble ${msg.role}`}>
                <header>
                  {msg.role === "user" ? "你" : "助手"} · {formatTime(msg.createdAt)}
                </header>
                <p>{msg.content}</p>
              </article>
            ))
          )}
          {loading ? (
            <article className="bubble assistant pending" aria-live="polite">
              <header>助手</header>
              <p>正在回复…</p>
            </article>
          ) : null}
        </div>

        <form className="composer" onSubmit={onSend}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              status.hasApiKey || status.mockMode
                ? "输入消息，Enter 发送，Shift+Enter 换行"
                : "尚未配置密钥：发送会提示错误，或先打开本地演示"
            }
            rows={3}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void onSend();
              }
            }}
          />
          <button type="submit" disabled={loading || !draft.trim()}>
            {loading ? "发送中…" : "发送"}
          </button>
        </form>
      </main>

      {sidebarOpen ? (
        <button
          className="backdrop"
          type="button"
          aria-label="关闭侧栏"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      {settingsOpen ? (
        <div className="modal" role="dialog" aria-labelledby="settings-title">
          <form className="panel" onSubmit={onSaveSettings}>
            <h3 id="settings-title">设置</h3>
            <p>
              密钥保存在本机配置文件，不会提交到仓库。也可使用环境变量{" "}
              <code>DEEPSEEK_API_KEY</code>。
            </p>
            <label>
              DeepSeek API 密钥
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="sk-…"
                autoComplete="off"
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={mockMode}
                onChange={(e) => setMockMode(e.target.checked)}
              />
              本地演示（不调用接口，仍写入聊天记录）
            </label>
            <p className="muted">当前模型：{status.model}（非思考模式，最低价 Flash）</p>
            {api.isTauri() ? (
              <button type="button" className="ghost" onClick={onOpenDir}>
                打开聊天记录目录
              </button>
            ) : null}
            <div className="row">
              <button type="button" className="ghost" onClick={() => setSettingsOpen(false)}>
                取消
              </button>
              <button type="submit" disabled={savingSettings}>
                {savingSettings ? "保存中…" : "保存"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {historyOpen ? (
        <div className="modal" role="dialog" aria-labelledby="history-title">
          <div className="panel wide">
            <h3 id="history-title">聊天记录</h3>
            <p className="muted">完整会话已写入磁盘（桌面版）或可在此导出。点选一条即可查看全文。</p>
            <div className="history-list">
              {sessions.map((item) => (
                <div key={item.id} className="history-item">
                  <div>
                    <strong>{item.title}</strong>
                    <span>
                      {item.messageCount} 条 · {formatTime(item.updatedAt)}
                    </span>
                  </div>
                  <div className="row">
                    <button
                      type="button"
                      onClick={() => {
                        void openSession(item.id);
                        setHistoryOpen(false);
                      }}
                    >
                      打开
                    </button>
                    <button type="button" onClick={() => onExport(item.id)}>
                      导出
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {current.messages.length > 0 ? (
              <pre className="transcript">
                {current.messages
                  .map(
                    (m) =>
                      `${m.role === "user" ? "用户" : "助手"} ${formatTime(m.createdAt)}\n${m.content}`,
                  )
                  .join("\n\n")}
              </pre>
            ) : (
              <p className="muted">当前对话还是空的。</p>
            )}
            <div className="row">
              <button type="button" onClick={onExportAll}>
                导出全部
              </button>
              <button type="button" className="ghost" onClick={() => setHistoryOpen(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
