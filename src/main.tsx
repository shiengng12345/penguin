import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import "./index.css";
import pkg from "../package.json";
import { getPersistedValue, hydratePersistedValues } from "./lib/app-persistence";
import { getAppValueFromDatabase, setAppValueInDatabase } from "./lib/penguin-db";
import { APP_VALUE_KEYS } from "./lib/persistence-keys";

const APP_VERSION = pkg.version;
const CACHE_VERSION_KEY = APP_VALUE_KEYS.cacheVersion;

async function syncPackageCacheVersion(): Promise<void> {
  await hydratePersistedValues();
  const lastVersion =
    getPersistedValue(CACHE_VERSION_KEY) ??
    await getAppValueFromDatabase(CACHE_VERSION_KEY);
  if (lastVersion === APP_VERSION) return;
  const persisted = await setAppValueInDatabase(CACHE_VERSION_KEY, APP_VERSION);
  if (persisted) {
    invoke("clear_all_packages").catch(() => {});
  }
}

void syncPackageCacheVersion();

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
