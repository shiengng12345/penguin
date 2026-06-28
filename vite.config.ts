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
      "@penguin/core": path.resolve(__dirname, "./packages/core/src/index.ts"),
    },
  },
  clearScreen: false,
  esbuild: {
    target: "es2022",
  },
  optimizeDeps: {
    esbuildOptions: {
      target: "es2022",
    },
  },
  build: {
    target: "es2022",
    // manualChunks splits heavy non-first-paint vendors out of the main App
    // chunk so cold start can paint earlier. Each chunk is cached separately,
    // so version bumps that touch only app code don't force a re-download
    // of CodeMirror / lucide. Numbers from build output:
    //   - codemirror group: ~400 KB raw / ~135 KB gzip (only loaded when a
    //     JSON editor mounts — not on first paint)
    //   - react vendor: ~140 KB raw / ~45 KB gzip (always needed but stable)
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            // CodeMirror — heaviest vendor, only used in JSON editor + request
            // body view. Split it out so first paint doesn't wait on it.
            if (id.includes("codemirror") || id.includes("@codemirror") || id.includes("@lezer")) {
              return "vendor-codemirror";
            }
            // React core — stable across releases, gets its own long-cache chunk.
            if (id.includes("react/") || id.includes("react-dom/") || id.includes("scheduler/")) {
              return "vendor-react";
            }
            // Tauri plugins — split because they're large and stable.
            if (id.includes("@tauri-apps/")) {
              return "vendor-tauri";
            }
          }
        },
      },
    },
  },
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
