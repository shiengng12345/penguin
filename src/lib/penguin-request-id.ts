// Auto request-correlation id attached to every outgoing Penguin request.
// The value is `penguin-<uuidv7>` — UUIDv7 is time-ordered, so ids sort by
// creation time, which makes them easy to scan in logs / history. The header
// is injected by the send pipeline (not the headers editor) and echoed back
// into the response headers so the user can read the id that was sent.

// HTTP/gRPC metadata key the id is sent under. Lower-case per HTTP/2 + gRPC
// metadata convention.
export const PENGUIN_REQUEST_ID_HEADER = "x-penguin-id";

// Value prefix so the id is recognisably ours in server logs.
const PENGUIN_ID_PREFIX = "penguin-";

// RFC 9562 UUIDv7: 48-bit big-endian Unix-ms timestamp, 4-bit version (0111),
// 12 bits random, 2-bit variant (10), 62 bits random. Internal helper — the
// exported API returns a typed object, this returns the bare string.
function uuidv7(): string {
  const timestampMs = Date.now();
  const bytes = new Uint8Array(16);

  // Bytes 0-5: 48-bit timestamp, most-significant byte first.
  bytes[0] = Math.floor(timestampMs / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(timestampMs / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(timestampMs / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(timestampMs / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(timestampMs / 2 ** 8) & 0xff;
  bytes[5] = timestampMs & 0xff;

  // Bytes 6-15: random material (Web Crypto, available in the Tauri webview).
  const randomBytes = new Uint8Array(10);
  crypto.getRandomValues(randomBytes);
  bytes.set(randomBytes, 6);

  // Stamp version 7 into the high nibble of byte 6 (0x70) and the 10x variant
  // into the high bits of byte 8 (0x80), preserving the random low bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface PenguinRequestId {
  value: string;
}

// Generate a fresh `penguin-<uuidv7>` id. Called once per send so every
// request carries a unique, time-ordered correlation id.
export function generatePenguinRequestId(): PenguinRequestId {
  return { value: `${PENGUIN_ID_PREFIX}${uuidv7()}` };
}
