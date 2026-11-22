import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

export function hashPin(pin: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString('base64url');
  const hash = scryptSync(pin, salt, 32, SCRYPT).toString('base64url');
  return { hash, salt };
}

export function verifyPin(pin: string, hash: string, salt: string): boolean {
  const actual = scryptSync(pin, salt, 32, SCRYPT);
  const expected = Buffer.from(hash, 'base64url');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
