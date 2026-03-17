import { open } from "@tauri-apps/plugin-shell";

export const REPO_URL = "https://github.com/__REPO_OWNER__/__REPO_NAME__";
export const RELEASES_URL = `${REPO_URL}/releases/latest`;

export async function openRepository() {
  await open(REPO_URL);
}

export async function openReleasePage() {
  await open(RELEASES_URL);
}

