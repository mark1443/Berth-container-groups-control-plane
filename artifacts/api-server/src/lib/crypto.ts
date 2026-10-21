import crypto from "node:crypto";
import { logger } from "./logger";

/**
 * AES-256-GCM envelope for credentials and secret config values (ADR-003).
 *
 * Key material comes from BERTH_MASTER_KEY (base64 or hex, 32 bytes). When it
 * is absent the key is derived with HKDF from SESSION_SECRET, which keeps
 * ciphertext unreadable to anyone holding only the database; a warning is
 * logged once so the operator knows to set a dedicated key before relying
 * on it in production. `keyVersion` is stored next to every ciphertext so a
 * rotation can re-seal rows lazily.
 */
export const CURRENT_KEY_VERSION = 1;

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  const explicit = process.env.BERTH_MASTER_KEY;
  if (explicit) {
    const buf = /^[0-9a-fA-F]{64}$/.test(explicit)
      ? Buffer.from(explicit, "hex")
      : Buffer.from(explicit, "base64");
    if (buf.length !== 32) {
      throw new Error("BERTH_MASTER_KEY must decode to exactly 32 bytes");
    }
    cachedKey = buf;
    return buf;
  }
  const seed = process.env.SESSION_SECRET;
  if (!seed) {
    throw new Error("Set BERTH_MASTER_KEY (or SESSION_SECRET) so Berth can encrypt credentials");
  }
  logger.warn(
    "BERTH_MASTER_KEY is not set; deriving the encryption key from SESSION_SECRET. Set a dedicated 32-byte key before production use.",
  );
  cachedKey = Buffer.from(crypto.hkdfSync("sha256", seed, "berth", "berth-master-key-v1", 32));
  return cachedKey;
}

/** Returns base64(iv || tag || ciphertext). */
export function seal(plaintext: string, aad = ""): string {
  const key = loadKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, data]).toString("base64");
}

export function open(sealed: string, aad = ""): string {
  const key = loadKey();
  const buf = Buffer.from(sealed, "base64");
  if (buf.length < 28) throw new Error("Ciphertext is too short");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/** Stable hash of a JSON value, independent of key order. */
export function stableHash(value: unknown): string {
  return sha256(stableStringify(value));
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}
