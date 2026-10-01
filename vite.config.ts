declare const process: { env: Record<string, string | undefined> };

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { chatApiPlugin } from "./vite-plugin-chat-api.ts";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(() => ({
  plugins: [react(), chatApiPlugin()],
  clearScreen: false,
  server: {
    port: 43187,
    strictPort: true,
    host: host || true,
    allowedHosts: true as true,
    cors: true,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 43188,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  preview: {
    port: 43187,
    strictPort: true,
    host: true,
    allowedHosts: true as true,
    cors: true,
  },
}));
