use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;

const DEEPSEEK_MODEL: &str = "deepseek-flash";
const OPENAI_MODEL: &str = "gpt-4o-mini";
const DEEPSEEK_PRO_MODEL: &str = "deepseek-v4-pro";
const GPT_LUNA_MODEL: &str = "gpt-6-luna";
const DEEPSEEK_URL: &str = "https://api.deepseek.com/chat/completions";
const OPENAI_URL: &str = "https://api.openai.com/v1/chat/completions";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub created_at: String,
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default = "default_provider")]
    pub provider: String,
    #[serde(default)]
    pub model: String,
    pub messages: Vec<ChatMessage>,
}

fn default_provider() -> String {
    "deepseek".into()
}

fn default_preset() -> String {
    "deepseek".into()
}

fn default_model_id() -> String {
    DEEPSEEK_MODEL.into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub title: String,
    pub updated_at: String,
    pub message_count: usize,
    pub provider: String,
    #[serde(default)]
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub deepseek_api_key: String,
    pub openai_api_key: String,
    pub mock_mode: bool,
    pub provider: String,
    pub model_preset: String,
    pub model_id: String,
    pub custom_model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub has_deepseek_key: bool,
    pub has_openai_key: bool,
    pub mock_mode: bool,
    pub provider: String,
    pub model_preset: String,
    pub model_id: String,
    pub custom_model_id: String,
    pub history_dir: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigFile {
    #[serde(default)]
    api_key: String,
    #[serde(default)]
    deepseek_api_key: String,
    #[serde(default)]
    openai_api_key: String,
    #[serde(default)]
    mock_mode: bool,
    #[serde(default = "default_provider")]
    provider: String,
    #[serde(default = "default_preset")]
    model_preset: String,
    #[serde(default = "default_model_id")]
    model_id: String,
    #[serde(default)]
    custom_model_id: String,
}

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ApiMsg>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<Thinking>,
}

#[derive(Serialize)]
struct Thinking {
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Serialize)]
struct ApiMsg {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Option<Vec<ChatChoice>>,
    error: Option<ApiError>,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: Option<ChatMessageBody>,
}

#[derive(Deserialize)]
struct ChatMessageBody {
    content: Option<String>,
}

#[derive(Deserialize)]
struct ApiError {
    message: Option<String>,
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn normalize_provider(value: &str) -> String {
    if value == "openai" {
        "openai".into()
    } else {
        "deepseek".into()
    }
}

fn model_for(provider: &str) -> &'static str {
    if provider == "openai" {
        OPENAI_MODEL
    } else {
        DEEPSEEK_MODEL
    }
}

fn infer_provider(model: &str, fallback: &str) -> String {
    let id = model.trim().to_ascii_lowercase();
    if id.starts_with("deepseek") {
        "deepseek".into()
    } else if id.starts_with("gpt-") || id.starts_with("chatgpt") || id.starts_with("o1") || id.starts_with("o3")
    {
        "openai".into()
    } else {
        normalize_provider(fallback)
    }
}

fn normalize_preset(value: &str) -> String {
    match value {
        "deepseek" | "deepseek-pro" | "chatgpt" | "gpt-6-luna" | "custom" => value.into(),
        _ => default_preset(),
    }
}

fn resolve_model(preset: &str, custom_model_id: &str, fallback_provider: &str) -> (String, String) {
    match preset {
        "deepseek-pro" => ("deepseek".into(), DEEPSEEK_PRO_MODEL.into()),
        "chatgpt" => ("openai".into(), OPENAI_MODEL.into()),
        "gpt-6-luna" => ("openai".into(), GPT_LUNA_MODEL.into()),
        "custom" => {
            let model = custom_model_id.trim().to_string();
            (infer_provider(&model, fallback_provider), model)
        }
        _ => ("deepseek".into(), DEEPSEEK_MODEL.into()),
    }
}

fn provider_label(provider: &str) -> &'static str {
    if provider == "openai" {
        "OpenAI"
    } else {
        "DeepSeek"
    }
}

fn model_label(model: &str) -> String {
    let trimmed = model.trim();
    if trimmed.is_empty() {
        String::new()
    } else {
        trimmed.into()
    }
}

fn mask_key(key: &str) -> String {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        String::new()
    } else if trimmed.len() <= 8 {
        "********".into()
    } else {
        format!("{}…{}", &trimmed[..4], &trimmed[trimmed.len() - 4..])
    }
}

fn looks_masked(value: &str) -> bool {
    value.contains('…') || value.contains("****")
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Could not locate the app data folder: {e}"))
}

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|e| format!("Could not locate the config folder: {e}"))
}

fn sessions_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app)?.join("sessions");
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create the transcript folder: {e}"))?;
    Ok(dir)
}

fn exports_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app)?.join("exports");
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create the export folder: {e}"))?;
    Ok(dir)
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = config_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create the config folder: {e}"))?;
    Ok(dir.join("config.json"))
}

fn valid_id(id: &str) -> Result<(), String> {
    if id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        Ok(())
    } else {
        Err("Invalid session id.".into())
    }
}

fn session_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    valid_id(id)?;
    Ok(sessions_dir(app)?.join(format!("{id}.json")))
}

fn markdown_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    valid_id(id)?;
    Ok(sessions_dir(app)?.join(format!("{id}.md")))
}

fn empty_config() -> ConfigFile {
    ConfigFile {
        api_key: String::new(),
        deepseek_api_key: String::new(),
        openai_api_key: String::new(),
        mock_mode: false,
        provider: default_provider(),
        model_preset: default_preset(),
        model_id: default_model_id(),
        custom_model_id: String::new(),
    }
}

fn read_config_file(app: &AppHandle) -> ConfigFile {
    let path = match config_path(app) {
        Ok(p) => p,
        Err(_) => return empty_config(),
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return empty_config();
    };
    serde_json::from_str(&raw).unwrap_or_else(|_| empty_config())
}

fn deepseek_key_from(cfg: &ConfigFile) -> String {
    if !cfg.deepseek_api_key.trim().is_empty() {
        cfg.deepseek_api_key.trim().to_string()
    } else {
        cfg.api_key.trim().to_string()
    }
}

fn resolve_deepseek_key(app: &AppHandle) -> String {
    if let Ok(key) = std::env::var("DEEPSEEK_API_KEY") {
        let trimmed = key.trim().to_string();
        if !trimmed.is_empty() {
            return trimmed;
        }
    }
    deepseek_key_from(&read_config_file(app))
}

fn resolve_openai_key(app: &AppHandle) -> String {
    if let Ok(key) = std::env::var("OPENAI_API_KEY") {
        let trimmed = key.trim().to_string();
        if !trimmed.is_empty() {
            return trimmed;
        }
    }
    read_config_file(app).openai_api_key.trim().to_string()
}

fn next_key(incoming: &str, existing: &str) -> String {
    if incoming.trim().is_empty() {
        String::new()
    } else if looks_masked(incoming) {
        existing.to_string()
    } else {
        incoming.trim().to_string()
    }
}

fn write_session_files(app: &AppHandle, session: &Session) -> Result<(), String> {
    let json_path = session_path(app, &session.id)?;
    let md_path = markdown_path(app, &session.id)?;
    let json = serde_json::to_string_pretty(session).map_err(|e| e.to_string())?;
    fs::write(&json_path, json).map_err(|e| format!("Could not write the transcript: {e}"))?;
    fs::write(&md_path, session_to_markdown(session))
        .map_err(|e| format!("Could not write Markdown: {e}"))?;
    Ok(())
}

fn load_session_from_disk(app: &AppHandle, id: &str) -> Result<Session, String> {
    let path = session_path(app, id)?;
    let raw = fs::read_to_string(&path).map_err(|_| "Chat transcript not found.".to_string())?;
    let mut session: Session =
        serde_json::from_str(&raw).map_err(|e| format!("The transcript file is damaged: {e}"))?;
    session.provider = normalize_provider(&session.provider);
    if session.model.is_empty() {
        session.model = model_for(&session.provider).into();
    }
    Ok(session)
}

fn session_to_markdown(session: &Session) -> String {
    let mut out = String::new();
    out.push_str(&format!("# Chat transcript: {}\n\n", session.title));
    out.push_str(&format!("- Session ID: {}\n", session.id));
    out.push_str(&format!("- Model: {}\n", session.model));
    out.push_str(&format!("- Created: {}\n", session.created_at));
    out.push_str(&format!("- Updated: {}\n\n", session.updated_at));
    out.push_str("---\n\n");
    for msg in &session.messages {
        let who = match msg.role.as_str() {
            "user" => "You",
            "assistant" => "Assistant",
            "system" => "System",
            other => other,
        };
        let via = if msg.model.is_empty() {
            String::new()
        } else {
            format!(" · {}", model_label(&msg.model))
        };
        out.push_str(&format!("## {}{} ({})\n\n", who, via, msg.created_at));
        out.push_str(msg.content.trim());
        out.push_str("\n\n");
    }
    out
}

fn title_from_text(text: &str) -> String {
    let trimmed = text.trim().replace('\n', " ");
    let mut chars = trimmed.chars();
    let short: String = chars.by_ref().take(24).collect();
    if chars.next().is_some() {
        format!("{short}…")
    } else if short.is_empty() {
        "New chat".into()
    } else {
        short
    }
}

#[tauri::command]
fn get_status(app: AppHandle) -> Result<AppStatus, String> {
    let cfg = read_config_file(&app);
    let (provider, model_id) = resolve_model(&cfg.model_preset, &cfg.custom_model_id, &cfg.provider);
    Ok(AppStatus {
        has_deepseek_key: !resolve_deepseek_key(&app).is_empty(),
        has_openai_key: !resolve_openai_key(&app).is_empty(),
        mock_mode: cfg.mock_mode,
        provider,
        model_preset: normalize_preset(&cfg.model_preset),
        model_id: if cfg.model_id.is_empty() {
            model_id
        } else {
            cfg.model_id.clone()
        },
        custom_model_id: cfg.custom_model_id.clone(),
        history_dir: sessions_dir(&app)?.display().to_string(),
    })
}

#[tauri::command]
fn get_settings(app: AppHandle) -> Result<AppSettings, String> {
    let cfg = read_config_file(&app);
    let (provider, model_id) = resolve_model(&cfg.model_preset, &cfg.custom_model_id, &cfg.provider);
    Ok(AppSettings {
        deepseek_api_key: mask_key(&resolve_deepseek_key(&app)),
        openai_api_key: mask_key(&resolve_openai_key(&app)),
        mock_mode: cfg.mock_mode,
        provider,
        model_preset: normalize_preset(&cfg.model_preset),
        model_id: if cfg.model_id.is_empty() {
            model_id
        } else {
            cfg.model_id
        },
        custom_model_id: cfg.custom_model_id,
    })
}

#[tauri::command]
fn save_settings(
    app: AppHandle,
    deepseek_api_key: String,
    openai_api_key: String,
    mock_mode: bool,
    provider: String,
    model_preset: Option<String>,
    model_id: Option<String>,
    custom_model_id: Option<String>,
) -> Result<AppStatus, String> {
    let path = config_path(&app)?;
    let existing = read_config_file(&app);
    let preset = normalize_preset(model_preset.as_deref().unwrap_or(&existing.model_preset));
    let custom = custom_model_id.unwrap_or(existing.custom_model_id.clone());
    let (resolved_provider, resolved_model) = resolve_model(&preset, &custom, &provider);
    let model = model_id
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(resolved_model);
    let body = serde_json::json!({
        "deepseekApiKey": next_key(&deepseek_api_key, &deepseek_key_from(&existing)),
        "openaiApiKey": next_key(&openai_api_key, existing.openai_api_key.trim()),
        "mockMode": mock_mode,
        "provider": resolved_provider,
        "modelPreset": preset,
        "modelId": model,
        "customModelId": custom.trim()
    });
    fs::write(
        path,
        serde_json::to_string_pretty(&body).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("Could not save settings: {e}"))?;
    get_status(app)
}

#[tauri::command]
fn list_sessions(app: AppHandle) -> Result<Vec<SessionSummary>, String> {
    let dir = sessions_dir(&app)?;
    let mut items = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| format!("Could not read transcripts: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(mut session) = serde_json::from_str::<Session>(&raw) else {
            continue;
        };
        session.provider = normalize_provider(&session.provider);
        items.push(SessionSummary {
            id: session.id,
            title: session.title,
            updated_at: session.updated_at,
            message_count: session.messages.len(),
            provider: session.provider,
            model: session.model,
        });
    }
    items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(items)
}

#[tauri::command]
fn create_session(
    app: AppHandle,
    provider: Option<String>,
    model: Option<String>,
) -> Result<Session, String> {
    let cfg = read_config_file(&app);
    let incoming_model = model.unwrap_or_else(|| cfg.model_id.clone());
    let model = if incoming_model.trim().is_empty() {
        model_for(&normalize_provider(provider.as_deref().unwrap_or(&cfg.provider))).into()
    } else {
        incoming_model.trim().to_string()
    };
    let provider = infer_provider(&model, provider.as_deref().unwrap_or(&cfg.provider));
    let session = Session {
        id: Uuid::new_v4().to_string(),
        title: "New chat".into(),
        created_at: now_iso(),
        updated_at: now_iso(),
        provider: provider.clone(),
        model,
        messages: vec![],
    };
    write_session_files(&app, &session)?;
    Ok(session)
}

#[tauri::command]
fn load_session(app: AppHandle, id: String) -> Result<Session, String> {
    load_session_from_disk(&app, &id)
}

#[tauri::command]
fn set_session_provider(
    app: AppHandle,
    id: String,
    provider: String,
    model: Option<String>,
) -> Result<Session, String> {
    let mut session = load_session_from_disk(&app, &id)?;
    let model = model
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| session.model.clone());
    session.provider = infer_provider(&model, &provider);
    session.model = if model.trim().is_empty() {
        model_for(&session.provider).into()
    } else {
        model
    };
    session.updated_at = now_iso();
    write_session_files(&app, &session)?;
    Ok(session)
}

#[tauri::command]
fn delete_session(app: AppHandle, id: String) -> Result<(), String> {
    let json = session_path(&app, &id)?;
    let md = markdown_path(&app, &id)?;
    let _ = fs::remove_file(json);
    let _ = fs::remove_file(md);
    Ok(())
}

#[tauri::command]
fn export_session(app: AppHandle, id: String) -> Result<String, String> {
    let session = load_session_from_disk(&app, &id)?;
    let safe_title: String = session
        .title
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .take(32)
        .collect();
    let filename = format!(
        "{}_{}.md",
        safe_title,
        &session.id[..8.min(session.id.len())]
    );
    let dest = exports_dir(&app)?.join(filename);
    fs::write(&dest, session_to_markdown(&session)).map_err(|e| format!("Export failed: {e}"))?;
    Ok(dest.display().to_string())
}

#[tauri::command]
fn export_all_sessions(app: AppHandle) -> Result<String, String> {
    let dir = sessions_dir(&app)?;
    let stamp = Utc::now().format("%Y%m%d-%H%M%S");
    let dest = exports_dir(&app)?.join(format!("all_transcripts_{stamp}.md"));
    let mut combined = String::from("# All chat transcripts\n\n");
    let mut sessions = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            if let Ok(raw) = fs::read_to_string(&path) {
                if let Ok(session) = serde_json::from_str::<Session>(&raw) {
                    sessions.push(session);
                }
            }
        }
    }
    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    if sessions.is_empty() {
        combined.push_str("(No transcripts yet)\n");
    } else {
        for session in sessions {
            combined.push_str(&session_to_markdown(&session));
            combined.push_str("\n\n");
        }
    }
    fs::write(&dest, combined).map_err(|e| format!("Export failed: {e}"))?;
    Ok(dest.display().to_string())
}

#[tauri::command]
fn open_history_dir(app: AppHandle) -> Result<(), String> {
    let dir = sessions_dir(&app)?;
    app.opener()
        .open_path(dir.display().to_string(), None::<&str>)
        .map_err(|e| format!("Could not open the folder: {e}"))
}

#[tauri::command]
async fn send_message(
    app: AppHandle,
    session_id: String,
    content: String,
    provider: Option<String>,
    model: Option<String>,
) -> Result<Session, String> {
    let text = content.trim();
    if text.is_empty() {
        return Err("Enter a message to send.".into());
    }

    let mut session = load_session_from_disk(&app, &session_id)?;
    let cfg = read_config_file(&app);
    let model = model
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            if session.model.is_empty() {
                cfg.model_id.clone()
            } else {
                session.model.clone()
            }
        });
    if model.trim().is_empty() {
        return Err("Enter a model id.".into());
    }
    let provider = infer_provider(&model, provider.as_deref().unwrap_or(&session.provider));
    session.provider = provider.clone();
    session.model = model.clone();

    let user_msg = ChatMessage {
        id: Uuid::new_v4().to_string(),
        role: "user".into(),
        content: text.to_string(),
        created_at: now_iso(),
        provider: provider.clone(),
        model: model.clone(),
    };
    if session.messages.is_empty() {
        session.title = title_from_text(text);
    }
    session.messages.push(user_msg);
    session.updated_at = now_iso();
    write_session_files(&app, &session)?;

    let reply = if cfg.mock_mode {
        format!(
            "(Demo mode — {} was not called.) I saved your message: “{}”. This reply is stored in the local transcript.",
            model_label(&model),
            text.chars().take(80).collect::<String>()
        )
    } else {
        let key = if provider == "openai" {
            resolve_openai_key(&app)
        } else {
            resolve_deepseek_key(&app)
        };
        if key.is_empty() {
            let env_name = if provider == "openai" {
                "OPENAI_API_KEY"
            } else {
                "DEEPSEEK_API_KEY"
            };
            return Err(format!(
                "No API key is configured for {}. Add it in Settings or set {}. You can also enable Demo mode to try the app without a key.",
                provider_label(&provider),
                env_name
            ));
        }
        call_chat(&provider, &key, &session.messages, &model).await?
    };

    session.messages.push(ChatMessage {
        id: Uuid::new_v4().to_string(),
        role: "assistant".into(),
        content: reply,
        created_at: now_iso(),
        provider: provider.clone(),
        model,
    });
    session.updated_at = now_iso();
    write_session_files(&app, &session)?;
    Ok(session)
}

async fn call_chat(
    provider: &str,
    api_key: &str,
    history: &[ChatMessage],
    model: &str,
) -> Result<String, String> {
    let mut messages: Vec<ApiMsg> = vec![ApiMsg {
        role: "system".into(),
        content: "You are a helpful assistant. Answer in plain text only. Do not use Markdown headings, bold, lists, or code fences.".into(),
    }];
    for msg in history {
        if msg.role == "user" || msg.role == "assistant" {
            messages.push(ApiMsg {
                role: msg.role.clone(),
                content: msg.content.clone(),
            });
        }
    }

    let url = if provider == "openai" {
        OPENAI_URL
    } else {
        DEEPSEEK_URL
    };
    let body = ChatRequest {
        model: model.to_string(),
        messages,
        stream: false,
        thinking: if provider == "openai" {
            None
        } else {
            Some(Thinking {
                kind: "disabled".into(),
            })
        },
    };

    let client = reqwest::Client::builder()
        .use_rustls_tls()
        .build()
        .map_err(|e| format!("Could not create the network client: {e}"))?;

    let response = client
        .post(url)
        .bearer_auth(api_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Could not reach {}: {e}", provider_label(provider)))?;

    let status = response.status();
    let parsed: ChatResponse = response
        .json()
        .await
        .map_err(|e| format!("Could not parse the response: {e}"))?;

    if let Some(err) = parsed.error {
        return Err(err
            .message
            .unwrap_or_else(|| format!("{} returned an error.", provider_label(provider))));
    }
    if !status.is_success() {
        return Err(format!(
            "{} request failed (HTTP {status})",
            provider_label(provider)
        ));
    }

    parsed
        .choices
        .and_then(|c| c.into_iter().next())
        .and_then(|c| c.message)
        .and_then(|m| m.content)
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "The model returned no text.".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_status,
            get_settings,
            save_settings,
            list_sessions,
            create_session,
            load_session,
            set_session_provider,
            delete_session,
            export_session,
            export_all_sessions,
            open_history_dir,
            send_message
        ])
        .setup(|app| {
            let _ = sessions_dir(&app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
