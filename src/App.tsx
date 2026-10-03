import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./lib/api";
import type { AppStatus, ProviderId, Session, SessionSummary } from "./lib/types";
import { visiblePlainText } from "./lib/plainText";
import {
  MODEL_PRESETS,
  modelDisplayName,
  normalizePreset,
  presetFromModel,
  resolveModel,
  type ModelPresetId,
} from "./lib/models";

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

function viaLabel(model?: string): string {
  return modelDisplayName(model);
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
  const [modelPreset, setModelPreset] = useState<ModelPresetId>("deepseek");
  const [customModelId, setCustomModelId] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const booted = useRef(false);

  const active = useMemo(
    () => resolveModel(modelPreset, customModelId, provider),
    [modelPreset, customModelId, provider],
  );

  const refreshList = useCallback(async () => {
    const items = await api.listSessions();
    setSessions(items);
    return items;
  }, []);

  const openSession = useCallback(async (id: string) => {
    const session = await api.loadSession(id);
    setCurrent(session);
    const nextProvider = (session.provider as ProviderId) === "openai" ? "openai" : "deepseek";
    setProvider(nextProvider);
    const nextPreset = presetFromModel(session.model, nextProvider);
    setModelPreset(nextPreset);
    if (nextPreset === "custom" && session.model) {
      setCustomModelId(session.model);
    }
    setSendError(null);
    setSidebarOpen(false);
  }, []);

  const persistSettings = useCallback(
    async (next: {
      preset: ModelPresetId;
      custom: string;
      mock?: boolean;
      deepseek?: string;
      openai?: string;
    }) => {
      const resolved = resolveModel(next.preset, next.custom, provider);
      const settings = await api.settings();
      const s = await api.saveSettings({
        deepseekApiKey: next.deepseek ?? settings.deepseekApiKey,
        openaiApiKey: next.openai ?? settings.openaiApiKey,
        mockMode: next.mock ?? settings.mockMode,
        provider: resolved.provider,
        modelPreset: next.preset,
        modelId: resolved.modelId,
        customModelId: next.custom.trim(),
      });
      setStatus(s);
      setProvider(resolved.provider);
      setModelPreset(normalizePreset(s.modelPreset));
      setCustomModelId(s.customModelId);
      return resolved;
    },
    [provider],
  );

  const startNew = useCallback(async () => {
    const resolved = resolveModel(modelPreset, customModelId, provider);
    const session = await api.createSession(resolved.provider, resolved.modelId || "deepseek-flash");
    setCurrent(session);
    await refreshList();
    setSidebarOpen(false);
  }, [customModelId, modelPreset, provider, refreshList]);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      try {
        const s = await api.status();
        setStatus(s);
        setMockMode(s.mockMode);
        setProvider(s.provider);
        setModelPreset(normalizePreset(s.modelPreset));
        setCustomModelId(s.customModelId ?? "");
        const settings = await api.settings();
        setDeepseekKey(settings.deepseekApiKey);
        setOpenaiKey(settings.openaiApiKey);
        setModelPreset(normalizePreset(settings.modelPreset));
        setCustomModelId(settings.customModelId);
        const items = await refreshList();
        if (items[0]) await openSession(items[0].id);
        else {
          const resolved = resolveModel(
            normalizePreset(s.modelPreset),
            s.customModelId,
            s.provider,
          );
          const session = await api.createSession(resolved.provider, resolved.modelId || "deepseek-flash");
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

  async function persistModelChoice(nextPreset: ModelPresetId, nextCustom = customModelId) {
    setModelPreset(nextPreset);
    if (nextPreset === "custom") setCustomModelId(nextCustom);
    const resolved = await persistSettings({ preset: nextPreset, custom: nextCustom });
    if (current && resolved.modelId) {
      const updated = await api.setSessionProvider(current.id, resolved.provider, resolved.modelId);
      setCurrent(updated);
      await refreshList();
    }
  }

  async function onSend(event?: FormEvent) {
    event?.preventDefault();
    if (!current || loading) return;
    const text = draft.trim();
    if (!text) return;
    if (modelPreset === "custom" && !customModelId.trim()) {
      setSendError("Enter a model id, or choose a preset.");
      return;
    }
    const resolved = resolveModel(modelPreset, customModelId, provider);
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
          provider: resolved.provider,
          model: resolved.modelId,
        },
      ],
    };
    setCurrent(optimistic);
    try {
      await persistSettings({ preset: modelPreset, custom: customModelId });
      const updated = await api.sendMessage(current.id, text, resolved.provider, resolved.modelId);
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
      const resolved = await persistSettings({
        preset: modelPreset,
        custom: customModelId,
        mock: mockMode,
        deepseek: deepseekKey,
        openai: openaiKey,
      });
      const settings = await api.settings();
      setDeepseekKey(settings.deepseekApiKey);
      setOpenaiKey(settings.openaiApiKey);
      if (current && resolved.modelId) {
        const updated = await api.setSessionProvider(current.id, resolved.provider, resolved.modelId);
        setCurrent(updated);
        await refreshList();
      }
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
    const ready = active.provider === "openai" ? status.hasOpenaiKey : status.hasDeepseekKey;
    return ready ? "Ready" : "API key needed";
  }, [status, active.provider]);

  const placeholder = useMemo(() => {
    if (!status) return "Write a message";
    const ready = status.mockMode || (active.provider === "openai" ? status.hasOpenaiKey : status.hasDeepseekKey);
    return ready
      ? "Write a message. Enter to send, Shift+Enter for a new line."
      : "Add an API key in Settings, or turn on Demo mode.";
  }, [status, active.provider]);

  const modelControls = (
    <label className="provider-pick">
      <span>Model</span>
      <select
        value={modelPreset}
        onChange={(e) => void persistModelChoice(e.target.value as ModelPresetId)}
        aria-label="Chat model"
      >
        {MODEL_PRESETS.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.label}
          </option>
        ))}
      </select>
      {modelPreset === "custom" ? (
        <input
          className="custom-model"
          value={customModelId}
          onChange={(e) => setCustomModelId(e.target.value)}
          onBlur={() => void persistModelChoice("custom", customModelId)}
          placeholder="Model id, e.g. gpt-4.1"
          aria-label="Custom model id"
          autoComplete="off"
        />
      ) : null}
    </label>
  );

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
            <h1>STI-testing-chat</h1>
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
                  {viaLabel(item.model)} · {item.messageCount} · {formatTime(item.updatedAt)}
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
              {viaLabel(active.modelId || current.model)} · {keyHint}
            </p>
          </div>
          {modelControls}
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
              <p>Choose a model, then send a message. Every turn is saved to the local transcript with the model id.</p>
            </div>
          ) : (
            current.messages.map((msg) => (
              <article key={msg.id} className={`bubble ${msg.role}`}>
                <header>
                  {msg.role === "user" ? "You" : "Assistant"}
                  {msg.model ? ` · ${viaLabel(msg.model)}` : ""} · {formatTime(msg.createdAt)}
                </header>
                <p>{visiblePlainText(msg.content)}</p>
              </article>
            ))
          )}
          {loading ? (
            <article className="bubble assistant pending" aria-live="polite">
              <header>Assistant · {viaLabel(active.modelId)}</header>
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
              Default model
              <select
                value={modelPreset}
                onChange={(e) => setModelPreset(e.target.value as ModelPresetId)}
              >
                {MODEL_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
            {modelPreset === "custom" ? (
              <label>
                Custom model id
                <input
                  value={customModelId}
                  onChange={(e) => setCustomModelId(e.target.value)}
                  placeholder="Any provider model id"
                  autoComplete="off"
                />
              </label>
            ) : (
              <p className="muted">Sends as {active.modelId || "the selected model"}.</p>
            )}
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
                      {viaLabel(item.model)} · {item.messageCount} messages · {formatTime(item.updatedAt)}
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
                    const via = m.model ? ` · ${viaLabel(m.model)}` : "";
                    return `${who}${via} ${formatTime(m.createdAt)}\n${visiblePlainText(m.content)}`;
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
