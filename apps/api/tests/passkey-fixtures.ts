import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

import { ADMIN_ORIGIN } from './auth-fixtures.js';

/**
 * A passkey on a pretend device, for the API's tests: a P-256 key that answers WebAuthn's two ceremonies as a browser
 * hands them to the API (the `none` attestation, ES256 signatures). `verified` says whether the device checked who
 * holds it (fingerprint, face or PIN): the UV flag.
 */

type CborValue = number | string | Uint8Array | Map<CborValue, CborValue>;

const head = (major: number, length: number): Buffer => {
  if (length < 24) {
    return Buffer.from([(major << 5) | length]);
  }
  if (length < 0x100) {
    return Buffer.from([(major << 5) | 24, length]);
  }
  const bytes = Buffer.alloc(3);
  bytes[0] = (major << 5) | 25;
  bytes.writeUInt16BE(length, 1);
  return bytes;
};

/** CBOR (RFC 8949), only what attestation objects and COSE keys use. */
const cbor = (value: CborValue): Buffer => {
  if (typeof value === 'number') {
    return value >= 0 ? head(0, value) : head(1, -1 - value);
  }
  if (typeof value === 'string') {
    const text = Buffer.from(value, 'utf8');
    return Buffer.concat([head(3, text.length), text]);
  }
  if (value instanceof Uint8Array) {
    return Buffer.concat([head(2, value.length), value]);
  }
  return Buffer.concat([
    head(5, value.size),
    ...[...value].flatMap(([key, item]) => [cbor(key), cbor(item)]),
  ]);
};

const base64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');

const FLAG_PRESENT = 0x01;
const FLAG_VERIFIED = 0x04;
const FLAG_BACKUP_ELIGIBLE = 0x08;
const FLAG_BACKED_UP = 0x10;
const FLAG_ATTESTED = 0x40;

const RP_ID_HASH = createHash('sha256').update(new URL(ADMIN_ORIGIN).hostname).digest();

export const createPasskeyDevice = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credentialId = randomBytes(16);
  let counter = 0;
  let userHandle = '';

  const authenticatorData = (flags: number, attested?: Buffer): Buffer => {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(counter);
    return Buffer.concat([
      RP_ID_HASH,
      Buffer.from([flags]),
      count,
      ...(attested ? [attested] : []),
    ]);
  };

  const clientData = (type: 'webauthn.create' | 'webauthn.get', challenge: string) =>
    Buffer.from(JSON.stringify({ type, challenge, origin: ADMIN_ORIGIN, crossOrigin: false }));

  const flagsFor = (verified: boolean) =>
    FLAG_PRESENT | (verified ? FLAG_VERIFIED : 0) | FLAG_BACKUP_ELIGIBLE | FLAG_BACKED_UP;

  /** The answer to `/passkey/generate-register-options`, as `navigator.credentials.create` returns it. */
  const register = (
    options: { challenge: string; user: { id: string } },
    { verified = true } = {},
  ) => {
    userHandle = options.user.id;
    const coseKey = new Map<CborValue, CborValue>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x ?? '', 'base64url')],
      [-3, Buffer.from(jwk.y ?? '', 'base64url')],
    ]);
    const length = Buffer.alloc(2);
    length.writeUInt16BE(credentialId.length);
    const attested = Buffer.concat([Buffer.alloc(16), length, credentialId, cbor(coseKey)]);
    const attestationObject = cbor(
      new Map<CborValue, CborValue>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authenticatorData(flagsFor(verified) | FLAG_ATTESTED, attested)],
      ]),
    );
    return {
      id: base64url(credentialId),
      rawId: base64url(credentialId),
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: {
        clientDataJSON: base64url(clientData('webauthn.create', options.challenge)),
        attestationObject: base64url(attestationObject),
        transports: ['internal'],
      },
    };
  };

  /** The answer to `/passkey/generate-authenticate-options`, as `navigator.credentials.get` returns it. */
  const authenticate = (options: { challenge: string }, { verified = true } = {}) => {
    counter += 1;
    const data = authenticatorData(flagsFor(verified));
    const client = clientData('webauthn.get', options.challenge);
    const signature = sign(
      'sha256',
      Buffer.concat([data, createHash('sha256').update(client).digest()]),
      privateKey,
    );
    return {
      id: base64url(credentialId),
      rawId: base64url(credentialId),
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: {
        clientDataJSON: base64url(client),
        authenticatorData: base64url(data),
        signature: base64url(signature),
        userHandle,
      },
    };
  };

  return { register, authenticate };
};
