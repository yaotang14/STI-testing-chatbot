/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly TAURI_DEV_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
