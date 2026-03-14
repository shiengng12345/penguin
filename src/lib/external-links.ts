import { open } from "@tauri-apps/plugin-shell";

export const PENGUIN_SITE_URL = "https://shiengng12345.github.io/penguin/";

export async function openPenguinSite(): Promise<void> {
  await open(PENGUIN_SITE_URL);
}
