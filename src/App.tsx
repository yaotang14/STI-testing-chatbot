import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./lib/api";
import type { AppStatus, ProviderId, Session, SessionSummary } from "./lib/types";
import { providerLabel } from "./lib/types";

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en", {
    month: "short",
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
  const [deepseekKey, setDeepseekKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [mockMode, setMockMode] = useState(false);
  const [provider, setProvider] = useState<ProviderId>("deepseek");
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
    setProvider((session.provider as ProviderId) === "openai" ? "openai" : "deepseek");
    setSendError(null);
    setSidebarOpen(false);
  }, []);

  const startNew = useCallback(async () => {
    const session = await api.createSession(provider);
    setCurrent(session);
    await refreshList();
    setSidebarOpen(false);
  }, [provider, refreshList]);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      try {
        const s = await api.status();
        setStatus(s);
        setMockMode(s.mockMode);
        setProvider(s.provider);
        const settings = await api.settings();
        setDeepseekKey(settings.deepseekApiKey);
        setOpenaiKey(settings.openaiApiKey);
        const items = await refreshList();
        if (items[0]) await openSession(items[0].id);
        else {
          const session = await api.createSession(s.provider);
          setCurrent(session);
          await refreshList();
        }
      } catch (err) {
        setBootError(err instanceof Error ? err.message : "Could not start the app.");
      }
    })();
  }, [openSession, refreshList]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [current?.messages.length, loading]);

  async function persistProvider(next: ProviderId) {
    setProvider(next);
    const settings = await api.settings();
    const s = await api.saveSettings({
      deepseekApiKey: settings.deepseekApiKey,
      openaiApiKey: settings.openaiApiKey,
      mockMode: settings.mockMode,
      provider: next,
    });
    setStatus(s);
    if (current) {
      const updated = await api.setSessionProvider(current.id, next);
      setCurrent(updated);
      await refreshList();
    }
  }

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
          provider,
        },
      ],
    };
    setCurrent(optimistic);
    try {
      const updated = await api.sendMessage(current.id, text, provider);
      setCurrent(updated);
      await refreshList();
      setStatus(await api.status());
    } catch (err) {
      setCurrent(current);
      setDraft(text);
      setSendError(err instanceof Error ? err.message : "Could not send the message.");
    } finally {
      setLoading(false);
    }
  }

  async function onSaveSettings(event: FormEvent) {
    event.preventDefault();
    setSavingSettings(true);
    setSendError(null);
    try {
      const next = await api.saveSettings({
        deepseekApiKey: deepseekKey,
        openaiApiKey: openaiKey,
        mockMode,
        provider,
      });
      setStatus(next);
      const settings = await api.settings();
      setDeepseekKey(settings.deepseekApiKey);
      setOpenaiKey(settings.openaiApiKey);
      setNotice(mockMode ? "Demo mode is on. Messages are saved locally and no API is called." : "Settings saved.");
      setSettingsOpen(false);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Could not save settings.");
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
      setNotice(api.isTauri() ? `Exported to ${path}` : `Downloading ${path}`);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Export failed.");
    }
  }

  async function onExportAll() {
    try {
      const path = await api.exportAll();
      setNotice(api.isTauri() ? `Exported to ${path}` : `Downloading ${path}`);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Export failed.");
    }
  }

  async function onOpenDir() {
    try {
      await api.openHistoryDir();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Could not open the folder.");
    }
  }

  const emptyChat = !current || current.messages.length === 0;
  const keyHint = useMemo(() => {
    if (!status) return "";
    if (status.mockMode) return "Demo mode";
    const ready = provider === "openai" ? status.hasOpenaiKey : status.hasDeepseekKey;
    return ready ? "Ready" : "API key needed";
  }, [status, provider]);

  const placeholder = useMemo(() => {
    if (!status) return "Write a message";
    const ready = status.mockMode || (provider === "openai" ? status.hasOpenaiKey : status.hasDeepseekKey);
    return ready
      ? "Write a message. Enter to send, Shift+Enter for a new line."
      : "Add an API key in Settings, or turn on Demo mode.";
  }, [status, provider]);

  if (bootError) {
    return (
      <div className="boot-error">
        <h1>Could not start</h1>
        <p>{bootError}</p>
      </div>
    );
  }

  if (!status || !current) {
    return (
      <div className="boot-loading" role="status">
        Loading transcripts…
      </div>
    );
  }

  return (
    <div className="shell">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brand">
          <div>
            <p className="eyebrow">YAO TANG</p>
            <h1>Chat</h1>
          </div>
          <button className="ghost" type="button" onClick={startNew}>
            New chat
          </button>
        </div>
        <p className="path-hint" title={status.historyDir}>
          Transcripts: {status.historyDir}
        </p>
        <nav className="session-list" aria-label="Chat history">
          {sessions.length === 0 ? (
            <p className="muted">No saved conversations yet.</p>
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
                  {providerLabel(item.provider)} · {item.messageCount} · {formatTime(item.updatedAt)}
                </span>
              </button>
            ))
          )}
        </nav>
        <div className="sidebar-actions">
          <button type="button" onClick={() => setHistoryOpen(true)}>
            View transcripts
          </button>
          <button type="button" onClick={onExportAll}>
            Export all
          </button>
          <button type="button" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button
            className="menu"
            type="button"
            aria-label="Open conversation list"
            onClick={() => setSidebarOpen((v) => !v)}
          >
            Menu
          </button>
          <div>
            <h2>{current.title}</h2>
            <p>
              {providerLabel(provider)} · {keyHint}
            </p>
          </div>
          <label className="provider-pick">
            <span>Provider</span>
            <select
              value={provider}
              onChange={(e) => void persistProvider(e.target.value as ProviderId)}
              aria-label="Chat provider"
            >
              <option value="deepseek">DeepSeek</option>
              <option value="openai">ChatGPT</option>
            </select>
          </label>
          <div className="top-actions">
            <button type="button" onClick={() => onExport(current.id)}>
              Export
            </button>
            <button type="button" className="danger" onClick={() => onDelete(current.id)}>
              Delete
            </button>
          </div>
        </header>

        {notice ? (
          <div className="banner ok" role="status">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        ) : null}
        {sendError ? (
          <div className="banner err" role="alert">
            <span>{sendError}</span>
            <button type="button" onClick={() => setSendError(null)}>
              Dismiss
            </button>
          </div>
        ) : null}

        <div className="messages" ref={scroller}>
          {emptyChat ? (
            <div className="empty">
              <p>No messages yet.</p>
              <p>Choose DeepSeek or ChatGPT, then send a message. Every turn is saved to the local transcript.</p>
            </div>
          ) : (
            current.messages.map((msg) => (
              <article key={msg.id} className={`bubble ${msg.role}`}>
                <header>
                  {msg.role === "user" ? "You" : "Assistant"}
                  {msg.provider ? ` · ${providerLabel(msg.provider)}` : ""} · {formatTime(msg.createdAt)}
                </header>
                <p>{msg.content}</p>
              </article>
            ))
          )}
          {loading ? (
            <article className="bubble assistant pending" aria-live="polite">
              <header>Assistant · {providerLabel(provider)}</header>
              <p>Thinking…</p>
            </article>
          ) : null}
        </div>

        <form className="composer" onSubmit={onSend}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            rows={3}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void onSend();
              }
            }}
          />
          <button type="submit" disabled={loading || !draft.trim()}>
            {loading ? "Sending…" : "Send"}
          </button>
        </form>
      </main>

      {sidebarOpen ? (
        <button
          className="backdrop"
          type="button"
          aria-label="Close sidebar"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      {settingsOpen ? (
        <div className="modal" role="dialog" aria-labelledby="settings-title">
          <form className="panel" onSubmit={onSaveSettings}>
            <h3 id="settings-title">Settings</h3>
            <p>
              Keys are stored on this device and are never committed to git. You can also set{" "}
              <code>DEEPSEEK_API_KEY</code> and <code>OPENAI_API_KEY</code>.
            </p>
            <label>
              Default provider
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as ProviderId)}
              >
                <option value="deepseek">DeepSeek</option>
                <option value="openai">ChatGPT</option>
              </select>
            </label>
            <label>
              DeepSeek API key
              <input
                type="password"
                value={deepseekKey}
                onChange={(e) => setDeepseekKey(e.target.value)}
                placeholder="sk-…"
                autoComplete="off"
              />
            </label>
            <label>
              OpenAI API key
              <input
                type="password"
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
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
              Demo mode (no API calls; transcripts still save)
            </label>
            {api.isTauri() ? (
              <button type="button" className="ghost" onClick={onOpenDir}>
                Open transcript folder
              </button>
            ) : null}
            <div className="row">
              <button type="button" className="ghost" onClick={() => setSettingsOpen(false)}>
                Cancel
              </button>
              <button type="submit" disabled={savingSettings}>
                {savingSettings ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {historyOpen ? (
        <div className="modal" role="dialog" aria-labelledby="history-title">
          <div className="panel wide">
            <h3 id="history-title">Transcripts</h3>
            <p className="muted">
              Full conversations are written to disk in the desktop app, or exported from here.
            </p>
            <div className="history-list">
              {sessions.map((item) => (
                <div key={item.id} className="history-item">
                  <div>
                    <strong>{item.title}</strong>
                    <span>
                      {providerLabel(item.provider)} · {item.messageCount} messages · {formatTime(item.updatedAt)}
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
                      Open
                    </button>
                    <button type="button" onClick={() => onExport(item.id)}>
                      Export
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {current.messages.length > 0 ? (
              <pre className="transcript">
                {current.messages
                  .map((m) => {
                    const who = m.role === "user" ? "You" : "Assistant";
                    const via = m.provider ? ` · ${providerLabel(m.provider)}` : "";
                    return `${who}${via} ${formatTime(m.createdAt)}\n${m.content}`;
                  })
                  .join("\n\n")}
              </pre>
            ) : (
              <p className="muted">This conversation is empty.</p>
            )}
            <div className="row">
              <button type="button" onClick={onExportAll}>
                Export all
              </button>
              <button type="button" className="ghost" onClick={() => setHistoryOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
