// Password hashing using Node's built-in scrypt — no third-party dependency.
// Format stored in users.password_hash: `scrypt$<saltHex>$<hashHex>`.
import { randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);
const KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(password, salt, KEYLEN)) as Buffer;
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const derived = (await scryptAsync(password, salt, expected.length)) as Buffer;
  // Constant-time compare; guard against length mismatch which timingSafeEqual throws on.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
