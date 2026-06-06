// Generic destructive-action confirm dialog. Tauri WKWebView treats
// window.confirm inconsistently across platforms, so any "are you sure?"
// flow that previously used window.confirm is routed through this modal
// instead.

import { Button } from "@/components/ui/button";

export interface VaultConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function VaultConfirmModal(props: VaultConfirmModalProps) {
  const isOpen = props.open;
  // Modal hidden — short-circuit before rendering DOM.
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={props.onCancel} />
      <div
        className="relative z-50 w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-foreground">{props.title}</h2>
        <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{props.message}</p>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={props.onConfirm}>
            {props.confirmLabel ?? "Delete"}
          </Button>
        </div>
      </div>
    </div>
  );
}
