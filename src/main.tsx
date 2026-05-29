import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import "./index.css";
import pkg from "../package.json";

const APP_VERSION = pkg.version;
const CACHE_VERSION_KEY = "penguin-cache-version";
const lastVersion = localStorage.getItem(CACHE_VERSION_KEY);

function shouldPreserveLocalStorageKey(key: string): boolean {
  return key.startsWith("penguin-") && key !== CACHE_VERSION_KEY;
}

if (lastVersion !== APP_VERSION) {
  // Keep user data across app upgrades, including penguin-tutorial-seen.
  // Version changes only invalidate installed package files.
  const saved: Record<string, string> = {};
  for (const key of Object.keys(localStorage)) {
    if (!shouldPreserveLocalStorageKey(key)) continue;
    const val = localStorage.getItem(key);
    if (val !== null) saved[key] = val;
  }
  localStorage.clear();
  localStorage.setItem(CACHE_VERSION_KEY, APP_VERSION);
  for (const [key, val] of Object.entries(saved)) {
    localStorage.setItem(key, val);
  }
  invoke("clear_all_packages").catch(() => {});
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
