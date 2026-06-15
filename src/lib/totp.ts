// RFC 6238 TOTP — Time-based One-Time Password.
//
// Spec defaults (matched by every Authenticator app + most OTP servers):
//   - HMAC-SHA1
//   - 6-digit code
//   - 30-second window
//   - T0 = Unix epoch 0
//
// Secret is supplied as a base32 string (RFC 4648, the format every
// "scan this QR code" page emits). Whitespace + padding are tolerated;
// the standard alphabet is `A-Z2-7`.
//
// We rely on Web Crypto for the HMAC so no third-party crypto dep ships
// in the bundle. The browser context Tauri's WKWebView gives us has
// crypto.subtle available.

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export class TotpError extends Error {}

/** Decode an RFC 4648 base32 string to bytes. Tolerates lowercase,
 *  whitespace, and `=` padding (all of which appear in real-world
 *  otpauth secrets). Throws TotpError on invalid characters. */
export function decodeBase32(input: string): Uint8Array {
  const cleaned = input.replace(/\s+/g, "").replace(/=+$/u, "").toUpperCase();
  if (cleaned.length === 0) throw new TotpError("empty secret");

  let buffer = 0;
  let bitsLeft = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new TotpError(`invalid base32 character: ${ch}`);
    buffer = (buffer << 5) | idx;
    bitsLeft += 5;
    if (bitsLeft >= 8) {
      bitsLeft -= 8;
      out.push((buffer >> bitsLeft) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/** Encode a JS number as an 8-byte big-endian buffer (TOTP counter). */
function counterBytes(counter: number): Uint8Array {
  const buf = new Uint8Array(8);
  // JS bitwise ops are 32-bit. Split into high / low halves so we
  // handle the full 53-bit safe integer range.
  const high = Math.floor(counter / 0x100000000);
  const low = counter % 0x100000000;
  buf[0] = (high >>> 24) & 0xff;
  buf[1] = (high >>> 16) & 0xff;
  buf[2] = (high >>> 8) & 0xff;
  buf[3] = high & 0xff;
  buf[4] = (low >>> 24) & 0xff;
  buf[5] = (low >>> 16) & 0xff;
  buf[6] = (low >>> 8) & 0xff;
  buf[7] = low & 0xff;
  return buf;
}

export interface TotpOptions {
  // Default 30s. Some legacy services use 60s; expose for future use.
  periodSeconds?: number;
  // Default 6. Some services (Steam) use 5; expose for future use.
  digits?: number;
  // Default Date.now(). Inject for tests / time skew handling.
  now?: number;
}

export interface TotpResult {
  // Zero-padded numeric string of `digits` length.
  code: string;
  // Whole-second countdown until the next code rotates (0 < x ≤ period).
  secondsRemaining: number;
  // Fraction of the current window remaining, [0, 1]. Useful for
  // animated ring rendering — already smoothed below the second
  // boundary so the ring doesn't tick visibly.
  fractionRemaining: number;
}

export async function generateTotp(
  secretBase32: string,
  options: TotpOptions = {},
): Promise<TotpResult> {
  const period = options.periodSeconds ?? 30;
  const digits = options.digits ?? 6;
  const now = options.now ?? Date.now();

  const keyBytes = decodeBase32(secretBase32);
  const counter = Math.floor(now / 1000 / period);
  const counterBuf = counterBytes(counter);

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, counterBuf as BufferSource);
  const sig = new Uint8Array(sigBuf);

  // RFC 4226 §5.3 — dynamic truncation using the low nibble of the
  // last byte as the offset into the HMAC output.
  const offset = sig[sig.length - 1] & 0x0f;
  const truncated =
    ((sig[offset] & 0x7f) << 24) |
    ((sig[offset + 1] & 0xff) << 16) |
    ((sig[offset + 2] & 0xff) << 8) |
    (sig[offset + 3] & 0xff);

  const modulus = 10 ** digits;
  const code = String(truncated % modulus).padStart(digits, "0");

  const elapsedInWindow = (now / 1000) % period;
  const fractionRemaining = 1 - elapsedInWindow / period;
  const secondsRemaining = Math.max(1, Math.ceil(period - elapsedInWindow));

  return { code, secondsRemaining, fractionRemaining };
}

/** Pretty-print a 6-digit code with a center space — "512110" → "512 110". */
export function formatTotpCode(code: string): string {
  if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`;
  return code;
}
