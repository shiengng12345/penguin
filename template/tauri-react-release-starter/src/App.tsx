import { useEffect, useMemo, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import {
  ArrowUpRight,
  Boxes,
  Github,
  Loader2,
  Moon,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Sparkles,
  Sun,
} from "lucide-react";
import { openReleasePage, openRepository } from "@/lib/external-links";
import { applyTheme, getStoredTheme, type Theme } from "@/lib/theme";

const STACK = ["Tauri 2", "React 19", "Vite 6", "TypeScript", "Tailwind 4"];

const CHECKLIST = [
  "Replace app icons in src-tauri/icons",
  "Set your updater public key in tauri.conf.json",
  "Add TAURI_SIGNING_PRIVATE_KEY to GitHub secrets",
  "Release with pnpm release:ship <version>",
];

const FEATURES = [
  {
    icon: Rocket,
    title: "Release-ready",
    description: "macOS build workflow, updater artifacts, latest.json, and published GitHub releases are already wired.",
  },
  {
    icon: Boxes,
    title: "Template-safe",
    description: "Bootstrap script rewrites package name, bundle identifier, repo owner, repo name, and display strings.",
  },
  {
    icon: ShieldCheck,
    title: "Updater-aware",
    description: "Current version, update checks, download-and-install, and restart flow are included in the starter UI.",
  },
];

export default function App() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [currentVersion, setCurrentVersion] = useState("...");
  const [updateStatus, setUpdateStatus] = useState<
    "idle" | "checking" | "available" | "up-to-date" | "downloading" | "ready" | "error"
  >("idle");
  const [updateInfo, setUpdateInfo] = useState<Update | null>(null);
  const [error, setError] = useState("");
  const [downloadProgress, setDownloadProgress] = useState(0);

  useEffect(() => {
    const initialTheme = getStoredTheme();
    setTheme(initialTheme);
    applyTheme(initialTheme);
    getVersion().then(setCurrentVersion).catch(() => setCurrentVersion("unknown"));
  }, []);

  const heroBadge = useMemo(
    () => `Starter template · v${__APP_VERSION__}`,
    [],
  );

  const handleToggleTheme = () => {
    const nextTheme: Theme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    applyTheme(nextTheme);
  };

  const handleCheckUpdate = async () => {
    setUpdateStatus("checking");
    setError("");
    try {
      const update = await check();
      if (update) {
        setUpdateInfo(update);
        setUpdateStatus("available");
        return;
      }
      setUpdateStatus("up-to-date");
    } catch (err) {
      setUpdateStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDownloadAndInstall = async () => {
    if (!updateInfo) return;
    setUpdateStatus("downloading");
    setDownloadProgress(0);

    try {
      let totalLength = 0;
      let downloaded = 0;
      await updateInfo.downloadAndInstall((event) => {
        if (event.event === "Started" && event.data.contentLength) {
          totalLength = event.data.contentLength;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (totalLength > 0) {
            setDownloadProgress(Math.round((downloaded / totalLength) * 100));
          }
        } else if (event.event === "Finished") {
          setDownloadProgress(100);
        }
      });
      setUpdateStatus("ready");
    } catch (err) {
      setUpdateStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-6 py-8 md:px-8 md:py-10">
        <header className="flex items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1 text-xs text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              {heroBadge}
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight md:text-5xl">__APP_NAME__</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
                __APP_DESCRIPTION__
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleToggleTheme}
            className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-card/80 transition hover:border-primary/40 hover:bg-card"
            title="Toggle theme"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </header>

        <section className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-[28px] border border-border bg-card/80 p-6 shadow-2xl shadow-black/10 backdrop-blur">
            <div className="flex flex-wrap gap-2">
              {STACK.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-border bg-background/70 px-3 py-1 text-xs text-muted-foreground"
                >
                  {item}
                </span>
              ))}
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="rounded-3xl border border-border bg-background/70 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Installed</p>
                <p className="mt-3 text-3xl font-semibold">v{currentVersion}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  This value comes from the current installed app bundle.
                </p>
              </div>

              <div className="rounded-3xl border border-border bg-primary/10 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-primary">Release Flow</p>
                <p className="mt-3 text-2xl font-semibold">Tag and ship</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Use <code className="rounded bg-background/60 px-1 py-0.5">pnpm release:ship 0.1.0</code> then push tags.
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleCheckUpdate}
                disabled={updateStatus === "checking" || updateStatus === "downloading"}
                className="inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {updateStatus === "checking" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Check for updates
              </button>

              <button
                type="button"
                onClick={() => {
                  void openReleasePage();
                }}
                className="inline-flex items-center gap-2 rounded-2xl border border-border bg-background/70 px-4 py-3 text-sm font-medium transition hover:border-primary/40"
              >
                <ArrowUpRight className="h-4 w-4" />
                Open latest release
              </button>

              <button
                type="button"
                onClick={() => {
                  void openRepository();
                }}
                className="inline-flex items-center gap-2 rounded-2xl border border-border bg-background/70 px-4 py-3 text-sm font-medium transition hover:border-primary/40"
              >
                <Github className="h-4 w-4" />
                Open repository
              </button>

              {updateStatus === "available" && (
                <button
                  type="button"
                  onClick={handleDownloadAndInstall}
                  className="inline-flex items-center gap-2 rounded-2xl border border-border bg-success/15 px-4 py-3 text-sm font-medium text-foreground transition hover:border-success/40"
                >
                  <Rocket className="h-4 w-4" />
                  Download update {updateInfo?.version}
                </button>
              )}

              {updateStatus === "ready" && (
                <button
                  type="button"
                  onClick={() => {
                    void relaunch();
                  }}
                  className="inline-flex items-center gap-2 rounded-2xl border border-border bg-success/15 px-4 py-3 text-sm font-medium"
                >
                  <Rocket className="h-4 w-4" />
                  Restart to apply update
                </button>
              )}
            </div>

            <div className="mt-4 rounded-2xl border border-border bg-background/60 p-4 text-sm text-muted-foreground">
              {updateStatus === "idle" && "No update check has been run yet."}
              {updateStatus === "up-to-date" && "This app is already on the latest published release."}
              {updateStatus === "downloading" && `Downloading update... ${downloadProgress}%`}
              {updateStatus === "error" && error}
              {updateStatus === "available" &&
                `Version ${updateInfo?.version} is available and ready to download.`}
              {updateStatus === "ready" && "Update installed. Restart the app to use the new bundle."}
            </div>
          </div>

          <div className="rounded-[28px] border border-border bg-card/80 p-6 shadow-2xl shadow-black/10 backdrop-blur">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Ship Checklist</p>
            <div className="mt-5 space-y-3">
              {CHECKLIST.map((item, index) => (
                <div
                  key={item}
                  className="flex items-start gap-3 rounded-2xl border border-border bg-background/60 px-4 py-3"
                >
                  <div className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                    {index + 1}
                  </div>
                  <p className="text-sm text-foreground">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-4 md:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, description }) => (
            <article
              key={title}
              className="rounded-[24px] border border-border bg-card/80 p-5 shadow-xl shadow-black/5"
            >
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <h2 className="mt-4 text-lg font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
            </article>
          ))}
        </section>
      </div>
    </div>
  );
}

