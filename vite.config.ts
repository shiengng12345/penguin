import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { readFileSync } from "fs";

const host = process.env.TAURI_DEV_HOST;
const pkg = JSON.parse(readFileSync("package.json", "utf-8"));

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Bypass package.json `main` (which points to dist/ for Node) and use
      // core's TS source directly. Keeps Vite HMR working when editing core
      // files while still letting Node consumers (MCP) use the compiled output.
      "@pengvi/core": path.resolve(__dirname, "./packages/core/src/index.ts"),
    },
  },
  clearScreen: false,
  server: {
    port: 1430,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1431 } : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
