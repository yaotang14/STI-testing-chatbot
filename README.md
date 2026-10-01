# 姚唐 · DeepSeek 聊天

给姚唐用的本地 DeepSeek 桌面聊天客户端（Tauri）。可以发消息、看回复，并且**把完整聊天记录写到本机文件**，随时查看和导出。

当前调用的模型是 DeepSeek 官方最低价 Flash：**`deepseek-flash`**（DeepSeek-V4.1-Flash），并关闭思考模式，避免按 reasoner 计费。

## 功能

- 发送 / 接收中文对话，含空状态、发送中、缺密钥或接口失败提示
- 每轮对话写入本机 `sessions/*.json` 和同步的 `*.md`
- 侧栏查看历史、导出本段或全部 Markdown
- 没有 API 密钥也能打开应用；直接发送会给出明确错误。可在设置里打开「本地演示」试用记录落盘

## 准备密钥

1. 到 [DeepSeek 开放平台](https://platform.deepseek.com/) 申请 API Key
2. 任选一种方式（**不要把真实密钥提交到 Git**）：

```bash
export DEEPSEEK_API_KEY=sk-你的密钥
```

或复制 `config.example.json` 为应用配置文件（桌面版会在首次保存设置时自动写入配置目录）。

参考：

```json
{
  "apiKey": "sk-你的密钥",
  "mockMode": false
}
```

Linux 配置目录一般是 `~/.config/com.yaotang.deepseekchat/config.json`。  
聊天记录一般在 `~/.local/share/com.yaotang.deepseekchat/sessions/`。

macOS：`~/Library/Application Support/com.yaotang.deepseekchat/`  
Windows：`%APPDATA%\com.yaotang.deepseekchat\`

## 开发运行

需要：Node.js 18+、Rust **1.90+**（[rustup](https://rustup.rs/)）。桌面窗口另需各系统的 [Tauri 依赖](https://v2.tauri.app/start/prerequisites/)。

```bash
npm install
npm run dev
```

浏览器预览绑定 **http://127.0.0.1:43187**（避免占用 3000 / 5173 / 8080）。浏览器里聊天记录存在本机存储，可用「导出」下载 Markdown；带密钥时通过开发服务器代理访问 DeepSeek。

打开真正的桌面窗口：

```bash
npm run dev:desktop
```

## 打包安装包

在目标操作系统上执行：

```bash
npm install
npm run build:installer
```

产物在 `src-tauri/target/release/bundle/`（安装包是本地构建结果，不纳入 Git）。在 Linux 上会生成例如：

- `src-tauri/target/release/bundle/deb/姚唐DeepSeek聊天_0.1.0_amd64.deb`
- `src-tauri/target/release/bundle/appimage/姚唐DeepSeek聊天_0.1.0_amd64.AppImage`

其它目标系统：

| 系统 | 本仓库已配置的安装包 |
| --- | --- |
| Linux | `.deb`、AppImage |
| Windows | NSIS 安装程序（`.exe`） |
| macOS | `.dmg` |

当前 Linux 构建环境可以产出 `.deb` / AppImage。Windows 与 macOS 安装包请在对应系统上执行同一条 `npm run build:installer`。

安装 `.deb` 示例：

```bash
sudo dpkg -i src-tauri/target/release/bundle/deb/*.deb
```

AppImage 赋予执行权限后直接运行即可。

## 项目结构

- `src/` React 中文界面
- `src-tauri/` Tauri / Rust：调 DeepSeek、读写聊天记录
- `config.example.json`、`.env.example` 密钥模板（无真实密钥）
