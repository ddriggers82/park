import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Application-level encryption for secrets at rest (Plaid access tokens).
 *
 * Envelope format (dot-joined, all base64):  v1.<iv>.<authTag>.<ciphertext>
 * Algorithm: AES-256-GCM with a random 96-bit IV per message and a 128-bit auth tag.
 *
 * The key comes from PLAID_TOKEN_ENCRYPTION_KEY, which must decode (base64) to
 * exactly 32 bytes. Generate one with:  openssl rand -base64 32
 *
 * Legacy plaintext (rows written before encryption was added) is passed through
 * unchanged on read, so the migration is transparent: existing values keep working
 * and are re-written encrypted on the next save. See decryptSecret.
 */

const VERSION = 'v1';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

function getKey(): Buffer {
  const raw = process.env.PLAID_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'PLAID_TOKEN_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32',
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      `PLAID_TOKEN_ENCRYPTION_KEY must decode (base64) to 32 bytes, got ${key.length}. ` +
        'Generate one with: openssl rand -base64 32',
    );
  }
  return key;
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(`${VERSION}.`);
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join('.');
}

export function decryptSecret(value: string): string {
  // Backward compatibility: values written before encryption have no version
  // prefix. Return them unchanged so existing rows keep working until re-saved.
  if (!isEncrypted(value)) {
    return value;
  }
  const [, ivB64, tagB64, ctB64] = value.split('.');
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error('Malformed encrypted secret: expected v1.<iv>.<tag>.<ciphertext>');
  }
  const key = getKey();
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
