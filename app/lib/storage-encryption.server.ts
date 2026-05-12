import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

function loadKey(): Buffer {
  const hex = process.env.STORAGE_ENC_KEY;
  if (!hex) {
    throw new Error(
      "STORAGE_ENC_KEY is not set. Generate one with `openssl rand -hex 32` and add it to the deployment env.",
    );
  }
  const key = Buffer.from(hex, "hex");
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `STORAGE_ENC_KEY must be ${KEY_LENGTH} bytes (${KEY_LENGTH * 2} hex chars); got ${key.length} bytes.`,
    );
  }
  return key;
}

export function encrypt(plaintext: string): Uint8Array<ArrayBuffer> {
  const key = loadKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const packed = Buffer.concat([iv, authTag, ciphertext]);
  // Copy into a fresh ArrayBuffer-backed Uint8Array so Prisma's strict
  // `Uint8Array<ArrayBuffer>` typing on Bytes columns accepts it.
  const out = new Uint8Array(new ArrayBuffer(packed.byteLength));
  out.set(packed);
  return out;
}

export function decrypt(payload: Buffer | Uint8Array): string {
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Encrypted payload is too short to contain IV + auth tag.");
  }
  const key = loadKey();
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
