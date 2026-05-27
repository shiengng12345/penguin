import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import "./index.css";
import pkg from "../package.json";

const APP_VERSION = pkg.version;
const CACHE_VERSION_KEY = "penguin-cache-version";
const lastVersion = localStorage.getItem(CACHE_VERSION_KEY);

if (lastVersion !== APP_VERSION) {
  const keep = [
    "penguin-username",
    "penguin-theme",
    "penguin-tabs",
    "penguin-active-tab",
    "penguin-history",
    "penguin-grpc-web-environments",
    "penguin-grpc-web-active-env",
    "penguin-grpc-environments",
    "penguin-grpc-active-env",
    "penguin-sdk-environments",
    "penguin-sdk-active-env",
  ];
  const saved: Record<string, string> = {};
  for (const key of keep) {
    const val = localStorage.getItem(key);
    if (val) saved[key] = val;
  }
  localStorage.clear();
  localStorage.setItem(CACHE_VERSION_KEY, APP_VERSION);
  for (const [key, val] of Object.entries(saved)) {
    localStorage.setItem(key, val);
  }
  invoke("clear_all_packages").catch(() => {});
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
