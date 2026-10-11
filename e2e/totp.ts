import { createHmac } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** An authenticator app's code (RFC 6238: HMAC-SHA1, 30 seconds, 6 digits) for a base32 setup key. */
export const totpCode = (setupKey: string, at = Date.now()): string => {
  let bits = 0;
  let value = 0;
  const key: number[] = [];
  for (const char of setupKey.replace(/[\s=]/g, '').toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index === -1) {
      throw new Error('The setup key is not base32');
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      key.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac('sha1', Buffer.from(key)).update(counter).digest();
  const offset = (hmac.at(-1) ?? 0) & 0xf;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
};
