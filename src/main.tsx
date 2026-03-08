import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import "./index.css";

const APP_VERSION = __APP_VERSION__;
const CACHE_VERSION_KEY = "pengvi-cache-version";
const lastVersion = localStorage.getItem(CACHE_VERSION_KEY);

if (lastVersion !== APP_VERSION) {
  const keep = [
    "pengvi-username",
    "pengvi-theme",
    "pengvi-grpc-web-environments",
    "pengvi-grpc-web-active-env",
    "pengvi-grpc-environments",
    "pengvi-grpc-active-env",
    "pengvi-sdk-environments",
    "pengvi-sdk-active-env",
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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
