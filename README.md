# STI-testing-chat

A local desktop chat app (Tauri). Send and receive messages with **deepseek-flash**, **deepseek-v4-pro**, **gpt-4o-mini**, **gpt-6-luna**, or a custom model id, and save a full transcript on disk so you can review or export it later.

## Features

- Choose a model in the header (presets plus a Custom field for any model id)
- Empty, sending, and error states
- Chat bubbles show plain text (line breaks kept; Markdown is not rendered)
- Each turn is written to local `sessions/*.json` and a matching `.md` file, including which model handled the reply
- Open transcripts in the sidebar, export one conversation or all of them
- The app opens without API keys. Sending without a key shows a clear error. Turn on Demo mode in Settings to try transcripts without calling an API

## Models

| UI label (sent as) | Routed to |
| --- | --- |
| `deepseek-flash` (default) | DeepSeek API |
| `deepseek-v4-pro` | DeepSeek API |
| `gpt-4o-mini` | OpenAI API |
| `gpt-6-luna` | OpenAI API |
| Custom | inferred from the id (`deepseek…` → DeepSeek API, `gpt-…` → OpenAI API) |

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

Older builds used a different app identifier. New installs write to `com.sti.testingchat`.

## Development

Needs Node.js 18+ and Rust **1.90+** ([rustup](https://rustup.rs/)). The desktop window also needs [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```bash
npm install
npm run dev
```

The browser preview is **http://127.0.0.1:43187**. This Vite path works on Windows, macOS, and Linux (Node.js required). In the browser, transcripts live in local storage and can be exported. Chat requests go through the local `/api/chat` endpoint.

Desktop window:

```bash
npm run dev:desktop
```

## Installers

`tauri.conf.json` bundle targets are **`deb`**, **`appimage`**, **`nsis`**, and **`dmg`**. There is **no MSI** target. Run `npm run build:installer` **on the OS you want to ship** (Windows NSIS on a Windows machine, `.dmg` on macOS, `.deb`/AppImage on Linux). Cross-building a Windows installer from macOS or Linux is not set up in this repo.

```bash
npm install
npm run build:installer
```

Artifacts land in `src-tauri/target/release/bundle/` (not committed). There is no GitHub Release URL in this project.

| OS | Configured bundles | Build command (on that OS) | Install helper |
| --- | --- | --- | --- |
| Linux | `.deb`, AppImage | `npm run build:installer` | `sudo dpkg -i src-tauri/target/release/bundle/deb/*.deb` |
| Windows | NSIS (`.exe`), current-user install | `npm run build:installer` | `scripts/install-windows.ps1` |
| macOS | `.dmg` | `npm run build:installer` | `scripts/install-macos.sh` |

On another Mac, after a `.dmg` exists (or is copied next to the machine):

```bash
chmod +x scripts/install-macos.sh
scripts/install-macos.sh
# or: scripts/install-macos.sh /path/to/STI-testing-chat.dmg
```

On another Windows PC, after an NSIS `.exe` exists:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
# or: powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1 -InstallerPath C:\path\STI-testing-chat-setup.exe
```

If the Windows `.exe` is missing, `install-windows.ps1` exits with a clear error: build on Windows first. It will not try to install a `.dmg` or `.deb` on Windows.

Make an AppImage executable, then run it.

## Layout

- `src/` React UI
- `src-tauri/` Tauri / Rust: provider APIs and transcript files
- `config.example.json`, `.env.example` — key templates (no real secrets)
