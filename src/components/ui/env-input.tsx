import * as React from "react";
import { cn } from "@/lib/utils";

interface EnvInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  value: string;
  onChange: (value: string) => void;
}

const ENV_VAR_RE = /(\{\{\s*\w+\s*\}\})/g;

function Highlighted({ text }: { text: string }) {
  const parts = text.split(ENV_VAR_RE);
  return (
    <>
      {parts.map((part, i) =>
        ENV_VAR_RE.test(part) ? (
          <span
            key={i}
            className="inline-flex items-center rounded bg-primary/15 text-primary px-1 mx-px font-semibold"
          >
            {part}
          </span>
        ) : (
          <span key={i} className="whitespace-pre">
            {part}
          </span>
        )
      )}
    </>
  );
}

const EnvInput = React.forwardRef<HTMLDivElement, EnvInputProps>(
  ({ className, value, onChange, placeholder, disabled, ...rest }, ref) => {
    const inputRef = React.useRef<HTMLInputElement>(null);

    return (
      <div
        ref={ref}
        className={cn(
          "relative flex items-center h-9 w-full rounded-md border border-input bg-transparent text-sm transition-colors focus-within:ring-1 focus-within:ring-ring",
          disabled && "cursor-not-allowed opacity-50",
          className
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {/* Overlay: shows highlighted tokens, invisible when input is focused and empty */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center px-3 overflow-hidden font-mono text-sm text-transparent"
        >
          <span className="truncate !text-transparent">
            <Highlighted text={value} />
          </span>
        </div>

        {/* Real input: text is transparent when there are env vars so overlay shows through */}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            "w-full h-full bg-transparent px-3 py-1 font-mono text-sm outline-none placeholder:text-muted-foreground",
            ENV_VAR_RE.test(value) ? "text-transparent caret-foreground" : "text-foreground"
          )}
          {...rest}
        />

        {/* Visible overlay that renders the highlighted text */}
        {ENV_VAR_RE.test(value) && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center px-3 overflow-hidden font-mono text-sm"
          >
            <span className="truncate">
              <Highlighted text={value} />
            </span>
          </div>
        )}
      </div>
    );
  }
);
EnvInput.displayName = "EnvInput";

export { EnvInput };
