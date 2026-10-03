import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number }
) => Promise<Buffer>;

const PREFIX = 'scrypt';
const KEY_LENGTH = 64;
const PARAMS = { N: 16384, r: 8, p: 1 };

// Stored as scrypt$N$r$p$saltB64$hashB64 so the parameters can change later.
export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH, PARAMS);
  return [PREFIX, PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export function isPasswordHash(stored: string) {
  return stored.startsWith(`${PREFIX}$`);
}

export async function verifyPassword(password: string, stored: string) {
  const [prefix, n, r, p, saltB64, hashB64] = stored.split('$');
  if (prefix !== PREFIX || !saltB64 || !hashB64) {
    return false;
  }
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p)
  });
  return timingSafeEqual(expected, actual);
}

/**
 * The fields to write for a user's new password. Sessions signed in before it end (see the
 * auth guard); `mustChange` makes the user choose their own at next sign-in.
 */
export function newPasswordFields(passwordHash: string, mustChange: boolean) {
  return { password: passwordHash, passwordChangedAt: new Date(), mustChangePassword: mustChange };
}

export function validateNewPassword(password: unknown) {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters';
  }
  if (password.length > 128) {
    return 'Password must be at most 128 characters';
  }
  return null;
}
