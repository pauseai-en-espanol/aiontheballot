import type { createAuthPool } from '@aiontheballot/db/auth-pool';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';

import { hashPassword } from 'better-auth/crypto';
import { createHmac, randomInt } from 'node:crypto';

/** Fictional settings only: nothing here is a real host, secret or name. */
export const ADMIN_ORIGIN = 'https://admin.ejemplo.test';
export const ADMIN_HOST = new URL(ADMIN_ORIGIN).host;
export const TOTP_ISSUER = 'Plataforma de ejemplo';
export const SECRET = 'a-test-secret-of-at-least-thirty-two-characters';
export const PASSWORD = 'una contraseña de ejemplo';

type AuthPool = ReturnType<typeof createAuthPool>;

/**
 * An account as the invitation flow will create it (email verified, a password, no TOTP): straight into Better Auth's
 * tables as aiontheballot_auth, since sign-up is closed.
 */
export const createAccount = async (pool: AuthPool, password = PASSWORD) => {
  const email = `persona-${crypto.randomUUID()}@example.org`;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (name, email, email_verified) VALUES ('Persona de ejemplo', $1, true) RETURNING id`,
    [email],
  );
  const id = rows[0]?.id ?? '';
  await pool.query(
    `INSERT INTO accounts (account_id, provider_id, user_id, password, updated_at)
     VALUES ($1, 'credential', $2, $3, now())`,
    [id, id, await hashPassword(password)],
  );
  return { id, email, password };
};

/** Removes an account and everything Better Auth kept for it (its sessions, factors and pending challenges). */
export const deleteAccount = async (pool: AuthPool, id: string) => {
  await pool.query('DELETE FROM verifications WHERE value = $1', [id]);
  await pool.query('DELETE FROM users WHERE id = $1', [id]);
};

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const fromBase32 = (input: string): Buffer => {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of input.replace(/=+$/, '').toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index === -1) {
      throw new Error('The secret is not base32');
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
};

/** An authenticator app's code (RFC 6238: HMAC-SHA1, 30 seconds, 6 digits) for the secret of an `otpauth://` URI. */
export const totpCode = (totpUri: string, at = Date.now()): string => {
  const secret = new URL(totpUri).searchParams.get('secret') ?? '';
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac('sha1', fromBase32(secret)).update(counter).digest();
  const offset = (hmac.at(-1) ?? 0) & 0xf;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
};

const hex16 = () => randomInt(0, 0x10000).toString(16).padStart(4, '0');

/**
 * An address from the documentation range (RFC 3849), different for each browser so their attempts count apart: random
 * in its first 64 bits, which is what Better Auth's limiter counts an IPv6 address by.
 */
export const testAddress = () => `2001:db8:${hex16()}:${hex16()}::1`;

/** How Better Auth's limiter writes such an address in its keys: its /64, written out in full. */
export const limiterAddress = (address: string) => {
  const [, , a = '', b = ''] = address.split(':');
  return `2001:0db8:${a}:${b}:0000:0000:0000:0000`;
};

/**
 * A browser on the admin host, behind the gateway: it keeps its cookies, sends the admin's Origin and arrives with
 * the `X-Forwarded-For` the gateway would add.
 */
export const browser = (app: FastifyInstance, address = testAddress()) => {
  const jar = new Map<string, string>();
  const send = async (
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<LightMyRequestResponse> => {
    const response = await app.inject({
      method,
      url,
      headers: {
        host: ADMIN_HOST,
        origin: ADMIN_ORIGIN,
        'x-forwarded-for': address,
        ...(jar.size > 0
          ? { cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; ') }
          : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });
    for (const cookie of response.cookies as { name: string; value: string; maxAge?: number }[]) {
      if (cookie.value === '' || cookie.maxAge === 0) {
        jar.delete(cookie.name);
      } else {
        jar.set(cookie.name, cookie.value);
      }
    }
    return response;
  };
  return { send, jar, address };
};
