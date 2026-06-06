// Sprint 4 — brand marks rendered as inline SVG so the list view can show a
// recognizable logo per credential kind instead of generic lucide icons.
// Marks are simplified shapes (NOT verbatim official logos) — close enough
// for at-a-glance identification, no licensing entanglements.

import type { VaultCredentialKind } from "./types";

interface VaultBrandIconProps {
  kind: VaultCredentialKind;
  className?: string;
}

export function VaultBrandIcon(props: VaultBrandIconProps) {
  const cls = props.className ?? "h-5 w-5";
  const common = { className: cls, viewBox: "0 0 24 24", fill: "currentColor" } as const;
  switch (props.kind) {
    case "vault":
      // HashiCorp Vault — stylized shield with V.
      return (
        <svg {...common}>
          <path d="M12 2 4 5v6c0 5 3.5 9.5 8 11 4.5-1.5 8-6 8-11V5l-8-3Zm-2.5 7h5l-2.5 7-2.5-7Z" />
        </svg>
      );
    case "argocd":
      // Argo — octopus-ish circle with arms.
      return (
        <svg {...common}>
          <path d="M12 3a9 9 0 1 0 9 9h-2a7 7 0 1 1-7-7V3Zm4 2v3h3V5h-3Zm-4 3a4 4 0 1 0 4 4h-2a2 2 0 1 1-2-2V8Z" />
        </svg>
      );
    case "database":
      // Generic cylinder — Postgres, Mongo, MySQL all reuse this shape.
      return (
        <svg {...common}>
          <ellipse cx="12" cy="5" rx="8" ry="3" />
          <path d="M4 8v4c0 1.66 3.58 3 8 3s8-1.34 8-3V8c0 1.66-3.58 3-8 3S4 9.66 4 8Z" />
          <path d="M4 14v4c0 1.66 3.58 3 8 3s8-1.34 8-3v-4c0 1.66-3.58 3-8 3s-8-1.34-8-3Z" />
        </svg>
      );
    case "cache":
      // Redis-ish stacked rings.
      return (
        <svg {...common}>
          <path d="M12 3 3 8l9 5 9-5-9-5Zm-9 8 9 5 9-5v3l-9 5-9-5v-3Zm0 5 9 5 9-5v3l-9 5-9-5v-3Z" />
        </svg>
      );
    case "monitoring":
      // Grafana/Prometheus-style flame.
      return (
        <svg {...common}>
          <path d="M12 2c-2 4-5 5-5 9a5 5 0 0 0 10 0c0-2-1-3-2-4 0 2-1 3-2 3 0-3 2-5-1-8Z" />
        </svg>
      );
    case "web":
      // Globe with meridians.
      return (
        <svg {...common}>
          <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm0 2c1.4 0 3 2.6 3.6 6H8.4C9 6.6 10.6 4 12 4Zm-6 6h2c.1-2 .4-3.8 1-5.3A8 8 0 0 0 6 10Zm0 4a8 8 0 0 0 3 5.3c-.6-1.5-.9-3.3-1-5.3H6Zm6 6c-1.4 0-3-2.6-3.6-6h7.2c-.6 3.4-2.2 6-3.6 6Zm5-6c-.1 2-.4 3.8-1 5.3A8 8 0 0 0 18 14Zm-2-4h2a8 8 0 0 0-3-5.3c.6 1.5.9 3.3 1 5.3Z" />
        </svg>
      );
    case "api":
      // Server stack.
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="6" rx="1" />
          <rect x="3" y="14" width="18" height="6" rx="1" />
          <circle cx="7" cy="7" r="1" />
          <circle cx="7" cy="17" r="1" />
        </svg>
      );
    case "login":
      // Door + arrow.
      return (
        <svg {...common}>
          <path d="M15 3v2H6v14h9v2H4V3h11Zm3 5 4 4-4 4v-3h-7v-2h7V8Z" />
        </svg>
      );
    case "token":
      // Key.
      return (
        <svg {...common}>
          <path d="M14 2a6 6 0 1 1-5.7 8L2 16.3V22h5.7l1.6-1.6 1.5 1.5 2-2-1.5-1.5 2-2-1.5-1.5 2-2A6 6 0 0 1 14 2Zm0 4a2 2 0 1 0 2 2 2 2 0 0 0-2-2Z" />
        </svg>
      );
    case "link":
      // Chain link.
      return (
        <svg {...common}>
          <path d="M10 14a3 3 0 0 1 0-4l3-3a3 3 0 0 1 4 4l-1.5 1.5-1.4-1.4 1.5-1.5a1 1 0 0 0-1.4-1.4l-3 3a1 1 0 0 0 0 1.4Zm-1 1.4 1.4 1.4-1.5 1.5a3 3 0 0 1-4-4l3-3a3 3 0 0 1 4 0L11.4 12a1 1 0 0 0-1.4 0l-3 3a1 1 0 0 0 1.4 1.4Z" />
        </svg>
      );
    case "generic":
    default:
      // Padlock.
      return (
        <svg {...common}>
          <path d="M12 2a5 5 0 0 0-5 5v3H5v12h14V10h-2V7a5 5 0 0 0-5-5Zm0 2a3 3 0 0 1 3 3v3H9V7a3 3 0 0 1 3-3Z" />
        </svg>
      );
  }
}
