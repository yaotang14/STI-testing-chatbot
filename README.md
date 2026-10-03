# STI-testing-chat

A local desktop chat app (Tauri). Send and receive messages with **DeepSeek**, **DeepSeek V4 Pro**, **ChatGPT**, **GPT-6 Luna**, or a custom model id, and save a full transcript on disk so you can review or export it later.

## Features

- Choose a model in the header (presets plus a Custom field for any model id)
- Empty, sending, and error states
- Chat bubbles show plain text (line breaks kept; Markdown is not rendered)
- Each turn is written to local `sessions/*.json` and a matching `.md` file, including which model handled the reply
- Open transcripts in the sidebar, export one conversation or all of them
- The app opens without API keys. Sending without a key shows a clear error. Turn on Demo mode in Settings to try transcripts without calling an API

## Models

| UI label | API id | Provider |
| --- | --- | --- |
| DeepSeek (default) | `deepseek-flash` | DeepSeek |
| DeepSeek V4 Pro | `deepseek-v4-pro` | DeepSeek |
| ChatGPT | `gpt-4o-mini` | OpenAI |
| GPT-6 Luna | `gpt-6-luna` | OpenAI |
| Custom | whatever you type | inferred from the id (`deepseek…` → DeepSeek, `gpt-…` → OpenAI) |

The last custom id is saved in Settings. Chat requests send the selected or typed model id as-is.

## API keys

1. Create a DeepSeek key at the [DeepSeek platform](https://platform.deepseek.com/) and/or an OpenAI key at the [OpenAI platform](https://platform.openai.com/)
2. Use either method (**never commit real keys**):

```bash
export DEEPSEEK_API_KEY=sk-your-key
export OPENAI_API_KEY=sk-your-key
```

Or save keys in Settings. The desktop app writes `config.json` in the app config directory. See `config.example.json`.

Linux config: `~/.config/com.sti.testingchat/config.json`  
Linux transcripts: `~/.local/share/com.sti.testingchat/sessions/`  
macOS: `~/Library/Application Support/com.sti.testingchat/`  
Windows: `%APPDATA%\com.sti.testingchat\`

Previous builds used `com.yaotang.deepseekchat`. Older transcripts stay in that folder; new installs write to `com.sti.testingchat`.

## Development

Needs Node.js 18+ and Rust **1.90+** ([rustup](https://rustup.rs/)). The desktop window also needs [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```bash
npm install
npm run dev
```

The browser preview is **http://127.0.0.1:43187**. In the browser, transcripts live in local storage and can be exported. Chat requests go through the local `/api/chat` endpoint.

Desktop window:

```bash
npm run dev:desktop
```

## Installers

On the target OS:

```bash
npm install
npm run build:installer
```

Artifacts land in `src-tauri/target/release/bundle/` (not committed).

| OS | Configured bundles |
| --- | --- |
| Linux | `.deb`, AppImage |
| Windows | NSIS (`.exe`) |
| macOS | `.dmg` |

Example:

```bash
sudo dpkg -i src-tauri/target/release/bundle/deb/*.deb
```

Make an AppImage executable, then run it.

## Layout

- `src/` React UI
- `src-tauri/` Tauri / Rust: provider APIs and transcript files
- `config.example.json`, `.env.example` — key templates (no real secrets)
