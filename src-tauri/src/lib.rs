use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;

const MODEL: &str = "deepseek-flash";
const API_URL: &str = "https://api.deepseek.com/chat/completions";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub model: String,
    pub messages: Vec<ChatMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub title: String,
    pub updated_at: String,
    pub message_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub api_key: String,
    pub mock_mode: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub has_api_key: bool,
    pub mock_mode: bool,
    pub model: String,
    pub history_dir: String,
    pub key_source: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigFile {
    #[serde(default)]
    api_key: String,
    #[serde(default)]
    mock_mode: bool,
}

#[derive(Serialize)]
struct DeepSeekRequest {
    model: String,
    messages: Vec<DeepSeekMsg>,
    stream: bool,
    thinking: Thinking,
}

#[derive(Serialize)]
struct Thinking {
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Serialize)]
struct DeepSeekMsg {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct DeepSeekResponse {
    choices: Option<Vec<DeepSeekChoice>>,
    error: Option<DeepSeekError>,
}

#[derive(Deserialize)]
struct DeepSeekChoice {
    message: Option<DeepSeekMessageBody>,
}

#[derive(Deserialize)]
struct DeepSeekMessageBody {
    content: Option<String>,
}

#[derive(Deserialize)]
struct DeepSeekError {
    message: Option<String>,
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录：{e}"))
}

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|e| format!("无法定位配置目录：{e}"))
}

fn sessions_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app)?.join("sessions");
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建聊天记录目录：{e}"))?;
    Ok(dir)
}

fn exports_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app)?.join("exports");
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建导出目录：{e}"))?;
    Ok(dir)
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = config_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建配置目录：{e}"))?;
    Ok(dir.join("config.json"))
}

fn session_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("会话编号不合法".into());
    }
    Ok(sessions_dir(app)?.join(format!("{id}.json")))
}

fn markdown_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("会话编号不合法".into());
    }
    Ok(sessions_dir(app)?.join(format!("{id}.md")))
}

fn read_config_file(app: &AppHandle) -> ConfigFile {
    let path = match config_path(app) {
        Ok(p) => p,
        Err(_) => return ConfigFile {
            api_key: String::new(),
            mock_mode: false,
        },
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return ConfigFile {
            api_key: String::new(),
            mock_mode: false,
        };
    };
    serde_json::from_str(&raw).unwrap_or(ConfigFile {
        api_key: String::new(),
        mock_mode: false,
    })
}

fn resolve_api_key(app: &AppHandle) -> (String, String) {
    if let Ok(key) = std::env::var("DEEPSEEK_API_KEY") {
        let trimmed = key.trim().to_string();
        if !trimmed.is_empty() {
            return (trimmed, "env".into());
        }
    }
    let file = read_config_file(app);
    let trimmed = file.api_key.trim().to_string();
    if !trimmed.is_empty() {
        return (trimmed, "file".into());
    }
    (String::new(), "none".into())
}

fn write_session_files(app: &AppHandle, session: &Session) -> Result<(), String> {
    let json_path = session_path(app, &session.id)?;
    let md_path = markdown_path(app, &session.id)?;
    let json = serde_json::to_string_pretty(session).map_err(|e| e.to_string())?;
    fs::write(&json_path, json).map_err(|e| format!("写入聊天记录失败：{e}"))?;
    fs::write(&md_path, session_to_markdown(session)).map_err(|e| format!("写入 Markdown 失败：{e}"))?;
    Ok(())
}

fn load_session_from_disk(app: &AppHandle, id: &str) -> Result<Session, String> {
    let path = session_path(app, id)?;
    let raw = fs::read_to_string(&path).map_err(|_| "找不到该聊天记录".to_string())?;
    serde_json::from_str(&raw).map_err(|e| format!("聊天记录损坏：{e}"))
}

fn session_to_markdown(session: &Session) -> String {
    let mut out = String::new();
    out.push_str(&format!("# 聊天记录：{}\n\n", session.title));
    out.push_str(&format!("- 会话编号：{}\n", session.id));
    out.push_str(&format!("- 模型：{}\n", session.model));
    out.push_str(&format!("- 创建时间：{}\n", session.created_at));
    out.push_str(&format!("- 更新时间：{}\n\n", session.updated_at));
    out.push_str("---\n\n");
    for msg in &session.messages {
        let who = match msg.role.as_str() {
            "user" => "用户",
            "assistant" => "助手",
            "system" => "系统",
            other => other,
        };
        out.push_str(&format!("## {}（{}）\n\n", who, msg.created_at));
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
        "未命名对话".into()
    } else {
        short
    }
}

#[tauri::command]
fn get_status(app: AppHandle) -> Result<AppStatus, String> {
    let (key, source) = resolve_api_key(&app);
    let cfg = read_config_file(&app);
    Ok(AppStatus {
        has_api_key: !key.is_empty(),
        mock_mode: cfg.mock_mode,
        model: MODEL.into(),
        history_dir: sessions_dir(&app)?.display().to_string(),
        key_source: source,
    })
}

#[tauri::command]
fn get_settings(app: AppHandle) -> Result<AppSettings, String> {
    let (key, _) = resolve_api_key(&app);
    let cfg = read_config_file(&app);
    let masked = if key.is_empty() {
        String::new()
    } else if key.len() <= 8 {
        "********".into()
    } else {
        format!("{}…{}", &key[..4], &key[key.len() - 4..])
    };
    Ok(AppSettings {
        api_key: masked,
        mock_mode: cfg.mock_mode,
    })
}

#[tauri::command]
fn save_settings(app: AppHandle, api_key: String, mock_mode: bool) -> Result<AppStatus, String> {
    let path = config_path(&app)?;
    let existing = read_config_file(&app);
    let looks_masked = api_key.contains('…') || api_key.contains("****");
    let next_key = if api_key.trim().is_empty() {
        String::new()
    } else if looks_masked {
        existing.api_key
    } else {
        api_key.trim().to_string()
    };
    let body = serde_json::json!({
        "apiKey": next_key,
        "mockMode": mock_mode
    });
    fs::write(path, serde_json::to_string_pretty(&body).map_err(|e| e.to_string())?)
        .map_err(|e| format!("保存配置失败：{e}"))?;
    get_status(app)
}

#[tauri::command]
fn list_sessions(app: AppHandle) -> Result<Vec<SessionSummary>, String> {
    let dir = sessions_dir(&app)?;
    let mut items = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| format!("读取聊天记录失败：{e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(session) = serde_json::from_str::<Session>(&raw) else {
            continue;
        };
        items.push(SessionSummary {
            id: session.id,
            title: session.title,
            updated_at: session.updated_at,
            message_count: session.messages.len(),
        });
    }
    items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(items)
}

#[tauri::command]
fn create_session(app: AppHandle) -> Result<Session, String> {
    let session = Session {
        id: Uuid::new_v4().to_string(),
        title: "新对话".into(),
        created_at: now_iso(),
        updated_at: now_iso(),
        model: MODEL.into(),
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
    let filename = format!("{}_{}.md", safe_title, &session.id[..8.min(session.id.len())]);
    let dest = exports_dir(&app)?.join(filename);
    fs::write(&dest, session_to_markdown(&session)).map_err(|e| format!("导出失败：{e}"))?;
    Ok(dest.display().to_string())
}

#[tauri::command]
fn export_all_sessions(app: AppHandle) -> Result<String, String> {
    let dir = sessions_dir(&app)?;
    let stamp = Utc::now().format("%Y%m%d-%H%M%S");
    let dest = exports_dir(&app)?.join(format!("全部聊天记录_{stamp}.md"));
    let mut combined = String::from("# 全部聊天记录\n\n");
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
        combined.push_str("（暂无记录）\n");
    } else {
        for session in sessions {
            combined.push_str(&session_to_markdown(&session));
            combined.push_str("\n\n");
        }
    }
    fs::write(&dest, combined).map_err(|e| format!("导出失败：{e}"))?;
    Ok(dest.display().to_string())
}

#[tauri::command]
fn open_history_dir(app: AppHandle) -> Result<(), String> {
    let dir = sessions_dir(&app)?;
    app.opener()
        .open_path(dir.display().to_string(), None::<&str>)
        .map_err(|e| format!("无法打开目录：{e}"))
}

#[tauri::command]
async fn send_message(app: AppHandle, session_id: String, content: String) -> Result<Session, String> {
    let text = content.trim();
    if text.is_empty() {
        return Err("请输入要发送的内容".into());
    }

    let mut session = load_session_from_disk(&app, &session_id)?;
    let user_msg = ChatMessage {
        id: Uuid::new_v4().to_string(),
        role: "user".into(),
        content: text.to_string(),
        created_at: now_iso(),
    };
    if session.messages.is_empty() {
        session.title = title_from_text(text);
    }
    session.messages.push(user_msg);
    session.updated_at = now_iso();
    write_session_files(&app, &session)?;

    let cfg = read_config_file(&app);
    let reply = if cfg.mock_mode {
        mock_reply(text)
    } else {
        let (key, _) = resolve_api_key(&app);
        if key.is_empty() {
            return Err(
                "尚未配置 DeepSeek API 密钥。请在设置中填写，或设置环境变量 DEEPSEEK_API_KEY。也可以打开「本地演示」在没有密钥时试用界面和聊天记录。"
                    .into(),
            );
        }
        call_deepseek(&key, &session.messages).await?
    };

    session.messages.push(ChatMessage {
        id: Uuid::new_v4().to_string(),
        role: "assistant".into(),
        content: reply,
        created_at: now_iso(),
    });
    session.updated_at = now_iso();
    write_session_files(&app, &session)?;
    Ok(session)
}

fn mock_reply(user_text: &str) -> String {
    format!(
        "（本地演示，未调用 DeepSeek）我已记下你的话：「{}」。这条回复和你的消息都会写入本机聊天记录，可在侧栏查看或导出 Markdown。",
        user_text.chars().take(80).collect::<String>()
    )
}

async fn call_deepseek(api_key: &str, history: &[ChatMessage]) -> Result<String, String> {
    let mut messages: Vec<DeepSeekMsg> = vec![DeepSeekMsg {
        role: "system".into(),
        content: "你是姚唐的中文助手，回答简洁、准确、口语自然。".into(),
    }];
    for msg in history {
        if msg.role == "user" || msg.role == "assistant" {
            messages.push(DeepSeekMsg {
                role: msg.role.clone(),
                content: msg.content.clone(),
            });
        }
    }

    let body = DeepSeekRequest {
        model: MODEL.into(),
        messages,
        stream: false,
        thinking: Thinking {
            kind: "disabled".into(),
        },
    };

    let client = reqwest::Client::builder()
        .use_rustls_tls()
        .build()
        .map_err(|e| format!("无法创建网络客户端：{e}"))?;

    let response = client
        .post(API_URL)
        .bearer_auth(api_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("无法连接 DeepSeek：{e}"))?;

    let status = response.status();
    let parsed: DeepSeekResponse = response
        .json()
        .await
        .map_err(|e| format!("接口返回无法解析：{e}"))?;

    if let Some(err) = parsed.error {
        return Err(err.message.unwrap_or_else(|| "DeepSeek 返回错误".into()));
    }
    if !status.is_success() {
        return Err(format!("DeepSeek 请求失败（HTTP {status}）"));
    }

    parsed
        .choices
        .and_then(|c| c.into_iter().next())
        .and_then(|c| c.message)
        .and_then(|m| m.content)
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "模型没有返回文本".into())
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

