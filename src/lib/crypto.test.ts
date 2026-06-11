import { describe, it, expect, beforeAll } from 'vitest';
import { encryptSecret, decryptSecret, isEncrypted } from './crypto';

// A deterministic 32-byte key (base64) for tests only.
const TEST_KEY = Buffer.alloc(32, 7).toString('base64');

beforeAll(() => {
  process.env.PLAID_TOKEN_ENCRYPTION_KEY = TEST_KEY;
});

describe('crypto — AES-256-GCM secret envelope', () => {
  it('round-trips a value', () => {
    const plain = 'access-sandbox-3f2a1c-secret-token';
    expect(decryptSecret(encryptSecret(plain))).toBe(plain);
  });

  it('produces a versioned envelope distinct from the plaintext', () => {
    const ct = encryptSecret('hello');
    expect(ct).not.toBe('hello');
    expect(ct.startsWith('v1.')).toBe(true);
    expect(isEncrypted(ct)).toBe(true);
  });

  it('uses a random IV so the same plaintext encrypts differently each time', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
  });

  it('rejects tampered ciphertext (auth tag mismatch)', () => {
    const ct = encryptSecret('do-not-tamper');
    const parts = ct.split('.');
    // Corrupt the last byte of the ciphertext segment.
    const bytes = Buffer.from(parts[3], 'base64');
    bytes[bytes.length - 1] ^= 0xff;
    parts[3] = bytes.toString('base64');
    expect(() => decryptSecret(parts.join('.'))).toThrow();
  });

  it('passes through legacy plaintext (no version prefix) for migration', () => {
    // Pre-encryption rows are stored plaintext; reads must not break on them.
    expect(isEncrypted('access-sandbox-legacy')).toBe(false);
    expect(decryptSecret('access-sandbox-legacy')).toBe('access-sandbox-legacy');
  });

  it('fails loudly on a wrong-length key', () => {
    const prev = process.env.PLAID_TOKEN_ENCRYPTION_KEY;
    process.env.PLAID_TOKEN_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString('base64');
    expect(() => encryptSecret('x')).toThrow(/32 bytes/);
    process.env.PLAID_TOKEN_ENCRYPTION_KEY = prev;
  });

  it('fails loudly when the key is missing', () => {
    const prev = process.env.PLAID_TOKEN_ENCRYPTION_KEY;
    delete process.env.PLAID_TOKEN_ENCRYPTION_KEY;
    expect(() => encryptSecret('x')).toThrow(/PLAID_TOKEN_ENCRYPTION_KEY/);
    process.env.PLAID_TOKEN_ENCRYPTION_KEY = prev;
  });
});
