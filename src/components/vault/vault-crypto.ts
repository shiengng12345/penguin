export const VAULT_ENCRYPTED_SCHEMA = "penguin-vault-encrypted-v1";

const DATA_ALGORITHM = "AES-256-GCM";
const KEY_DERIVATION = "HKDF-SHA-256";
const WRAP_ALGORITHM = "AES-256-GCM-HKDF-SHA-256";
const DATA_KEY_BYTES = 32;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;

export type VaultRecipientId = "admin" | "super-admin";

export interface VaultCryptoTokens {
  adminToken?: string | null;
  superAdminToken?: string | null;
}

export interface VaultEnvelopeRecipient {
  id: VaultRecipientId;
  alg: typeof WRAP_ALGORITHM;
  nonce: string;
  wrappedKey: string;
}

export interface VaultEncryptedEnvelope {
  schema: typeof VAULT_ENCRYPTED_SCHEMA;
  alg: typeof DATA_ALGORITHM;
  kdf: typeof KEY_DERIVATION;
  salt: string;
  nonce: string;
  ciphertext: string;
  recipients: VaultEnvelopeRecipient[];
}

export interface EncryptVaultJsonPayload extends VaultCryptoTokens {
  plaintext: string;
}

export type DecryptVaultJsonResult =
  | { success: true; plaintext: string; recipientId: VaultRecipientId }
  | { success: false; reason: string; plaintext?: undefined; recipientId?: undefined };

export type ReencryptVaultJsonResult =
  | { success: true; envelope: VaultEncryptedEnvelope; recipientId: VaultRecipientId }
  | { success: false; reason: string; envelope?: undefined; recipientId?: undefined };

export interface DecryptVaultJsonPayload {
  envelope: unknown;
  tokens: VaultCryptoTokens;
}

export interface ReencryptVaultJsonPayload extends DecryptVaultJsonPayload {
  plaintext: string;
}

interface UnwrappedVaultEnvelope {
  envelope: VaultEncryptedEnvelope;
  dataKeyBytes: Uint8Array;
  recipientId: VaultRecipientId;
}

interface RecipientToken {
  id: VaultRecipientId;
  token: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function getVaultCryptoTokensFromToken(token: string | null | undefined): VaultCryptoTokens {
  const normalized = normalizeToken(token);
  if (normalized === null) return {};
  // The current token's tier is not needed here. Decryption tries both
  // recipient ids with the same raw token; only the matching HKDF context
  // authenticates.
  return {
    adminToken: normalized,
    superAdminToken: normalized,
  };
}

export async function encryptVaultJson(
  payload: EncryptVaultJsonPayload,
): Promise<VaultEncryptedEnvelope> {
  const recipients = getRequiredEncryptionRecipients(payload);
  const salt = randomBytes(SALT_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const dataKeyBytes = randomBytes(DATA_KEY_BYTES);
  const dataKey = await importAesKey(dataKeyBytes, ["encrypt", "decrypt"]);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toBufferSource(nonce),
      additionalData: dataAad(),
    },
    dataKey,
    toBufferSource(encoder.encode(payload.plaintext)),
  );

  const wrappedRecipients: VaultEnvelopeRecipient[] = [];
  for (const recipient of recipients) {
    const wrapKey = await deriveWrapKey({
      token: recipient.token,
      salt,
      recipientId: recipient.id,
    });
    const wrapNonce = randomBytes(NONCE_BYTES);
    const wrappedKey = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: toBufferSource(wrapNonce),
        additionalData: recipientAad(recipient.id),
      },
      wrapKey,
      toBufferSource(dataKeyBytes),
    );
    wrappedRecipients.push({
      id: recipient.id,
      alg: WRAP_ALGORITHM,
      nonce: encodeBase64(wrapNonce),
      wrappedKey: encodeBase64(new Uint8Array(wrappedKey)),
    });
  }

  return {
    schema: VAULT_ENCRYPTED_SCHEMA,
    alg: DATA_ALGORITHM,
    kdf: KEY_DERIVATION,
    salt: encodeBase64(salt),
    nonce: encodeBase64(nonce),
    ciphertext: encodeBase64(new Uint8Array(ciphertext)),
    recipients: wrappedRecipients,
  };
}

export async function decryptVaultJson(
  payload: DecryptVaultJsonPayload,
): Promise<DecryptVaultJsonResult> {
  const unwrapped = await unwrapVaultEnvelope(payload);
  if (!unwrapped.success) return unwrapped;
  try {
    const dataKey = await importAesKey(unwrapped.dataKeyBytes, ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toBufferSource(decodeBase64(unwrapped.envelope.nonce)),
        additionalData: dataAad(),
      },
      dataKey,
      toBufferSource(decodeBase64(unwrapped.envelope.ciphertext)),
    );
    return {
      success: true,
      plaintext: decoder.decode(plaintext),
      recipientId: unwrapped.recipientId,
    };
  } catch {
    return {
      success: false,
      reason: "unable to decrypt vault envelope with the available tokens",
    };
  }
}

export async function reencryptVaultJson(
  payload: ReencryptVaultJsonPayload,
): Promise<ReencryptVaultJsonResult> {
  const unwrapped = await unwrapVaultEnvelope(payload);
  if (!unwrapped.success) return unwrapped;
  const dataKey = await importAesKey(unwrapped.dataKeyBytes, ["encrypt"]);
  const nonce = randomBytes(NONCE_BYTES);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toBufferSource(nonce),
      additionalData: dataAad(),
    },
    dataKey,
    toBufferSource(encoder.encode(payload.plaintext)),
  );
  return {
    success: true,
    recipientId: unwrapped.recipientId,
    envelope: {
      ...unwrapped.envelope,
      nonce: encodeBase64(nonce),
      ciphertext: encodeBase64(new Uint8Array(ciphertext)),
    },
  };
}

export function isVaultEncryptedEnvelope(input: unknown): input is VaultEncryptedEnvelope {
  if (!isRecord(input)) return false;
  if (input.schema !== VAULT_ENCRYPTED_SCHEMA) return false;
  if (input.alg !== DATA_ALGORITHM) return false;
  if (input.kdf !== KEY_DERIVATION) return false;
  if (typeof input.salt !== "string") return false;
  if (typeof input.nonce !== "string") return false;
  if (typeof input.ciphertext !== "string") return false;
  if (!Array.isArray(input.recipients)) return false;
  return input.recipients.every(isVaultEnvelopeRecipient);
}

function getRequiredEncryptionRecipients(payload: VaultCryptoTokens): RecipientToken[] {
  const adminToken = normalizeToken(payload.adminToken);
  const superAdminToken = normalizeToken(payload.superAdminToken);
  if (adminToken === null || superAdminToken === null) {
    throw new Error("Both vault encryption tokens are required to upload encrypted Lark vault data.");
  }
  return [
    { id: "admin", token: adminToken },
    { id: "super-admin", token: superAdminToken },
  ];
}

function getAvailableDecryptionRecipients(tokens: VaultCryptoTokens): RecipientToken[] {
  const recipients: RecipientToken[] = [];
  const adminToken = normalizeToken(tokens.adminToken);
  if (adminToken !== null) recipients.push({ id: "admin", token: adminToken });
  const superAdminToken = normalizeToken(tokens.superAdminToken);
  if (superAdminToken !== null) recipients.push({ id: "super-admin", token: superAdminToken });
  return recipients;
}

async function unwrapVaultEnvelope(
  payload: DecryptVaultJsonPayload,
): Promise<
  | { success: true } & UnwrappedVaultEnvelope
  | { success: false; reason: string }
> {
  if (!isVaultEncryptedEnvelope(payload.envelope)) {
    return { success: false, reason: "not a Penguin vault encrypted envelope" };
  }
  const envelope = payload.envelope;
  const recipients = getAvailableDecryptionRecipients(payload.tokens);
  if (recipients.length === 0) {
    return { success: false, reason: "no vault decryption token is available" };
  }

  for (const recipient of recipients) {
    const wrapped = envelope.recipients.find((candidate) => candidate.id === recipient.id);
    if (wrapped === undefined) continue;
    try {
      const salt = decodeBase64(envelope.salt);
      const wrapKey = await deriveWrapKey({
        token: recipient.token,
        salt,
        recipientId: recipient.id,
      });
      const dataKeyBytes = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: toBufferSource(decodeBase64(wrapped.nonce)),
          additionalData: recipientAad(recipient.id),
        },
        wrapKey,
        toBufferSource(decodeBase64(wrapped.wrappedKey)),
      );
      return {
        success: true,
        envelope,
        dataKeyBytes: new Uint8Array(dataKeyBytes),
        recipientId: recipient.id,
      };
    } catch {
      // Try the next recipient token. AES-GCM auth failure is expected for
      // non-matching keys and should not expose partial plaintext.
    }
  }

  return {
    success: false,
    reason: "unable to decrypt vault envelope with the available tokens",
  };
}

function normalizeToken(token: string | null | undefined): string | null {
  const trimmed = token?.trim() ?? "";
  if (trimmed.length === 0) return null;
  return trimmed;
}

function isVaultEnvelopeRecipient(input: unknown): input is VaultEnvelopeRecipient {
  if (!isRecord(input)) return false;
  const isKnownId = input.id === "admin" || input.id === "super-admin";
  if (!isKnownId) return false;
  if (input.alg !== WRAP_ALGORITHM) return false;
  if (typeof input.nonce !== "string") return false;
  if (typeof input.wrappedKey !== "string") return false;
  return true;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}

async function deriveWrapKey(payload: {
  token: string;
  salt: Uint8Array;
  recipientId: VaultRecipientId;
}): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    toBufferSource(encoder.encode(payload.token)),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: toBufferSource(payload.salt),
      info: toBufferSource(encoder.encode(`penguin-vault:${payload.recipientId}:v1`)),
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function importAesKey(
  rawKey: Uint8Array,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    toBufferSource(rawKey),
    { name: "AES-GCM", length: 256 },
    false,
    usages,
  );
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function dataAad(): ArrayBuffer {
  return toBufferSource(encoder.encode("penguin-vault:payload:v1"));
}

function recipientAad(recipientId: VaultRecipientId): ArrayBuffer {
  return toBufferSource(encoder.encode(`penguin-vault:wrapped-key:${recipientId}:v1`));
}

function toBufferSource(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
