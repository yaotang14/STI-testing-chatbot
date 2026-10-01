declare const process: { env: Record<string, string | undefined> };

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(() => ({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 43187,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 43188,
        }
      : undefined,
    proxy: {
      "/deepseek-api": {
        target: "https://api.deepseek.com",
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/deepseek-api/, ""),
      },
      "/openai-api": {
        target: "https://api.openai.com",
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/openai-api/, ""),
      },
    },
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  preview: {
    port: 43187,
    strictPort: true,
    host: "127.0.0.1",
  },
}));
