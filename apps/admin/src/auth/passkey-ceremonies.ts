import {
  browserSupportsWebAuthn,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  startAuthentication,
  startRegistration,
  WebAuthnError,
} from '@simplewebauthn/browser';

import { type AuthError, authError, getAuth, postAuth } from './client';

/**
 * A passkey's two ceremonies from the browser (PLAN D22): the API's challenge, the device's answer, the API's check.
 * Each resolves to nothing when it worked, or to what went wrong. The device must check who holds it (fingerprint, face
 * or PIN): asked for here, and refused by the API otherwise.
 */

/** What a browser's refusal means: the person closed the prompt or let it time out, mostly. */
const ceremonyError = (error: unknown): AuthError =>
  error instanceof WebAuthnError && error.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED'
    ? 'passkeyExists'
    : 'passkeyCancelled';

const supported = () => typeof window !== 'undefined' && browserSupportsWebAuthn();

/** The API's challenge, as the browser helper takes it: Better Auth's own JSON, checked only for its challenge. */
const challenged = <T>(body: Record<string, unknown>): T | undefined =>
  typeof body.challenge === 'string' ? (body as T) : undefined;

/** Signs in with a passkey the person picks on their device: no email first (passkeys are discoverable). */
export const signInWithPasskey = async (): Promise<AuthError | undefined> => {
  if (!supported()) {
    return 'passkeyUnsupported';
  }
  const options = await getAuth('/passkey/generate-authenticate-options');
  const optionsJSON = challenged<PublicKeyCredentialRequestOptionsJSON>(options.body);
  if (!options.ok || !optionsJSON) {
    return authError(options);
  }
  let response;
  try {
    // Better Auth asks for the check only if the device offers it; we ask for it outright.
    response = await startAuthentication({
      optionsJSON: { ...optionsJSON, userVerification: 'required' },
    });
  } catch (error) {
    return ceremonyError(error);
  }
  const verified = await postAuth('/passkey/verify-authentication', { response });
  return verified.ok ? undefined : authError(verified);
};

/** Adds a passkey to the signed-in account, named as the person wrote (or not at all). */
export const addPasskey = async (name: string): Promise<AuthError | undefined> => {
  if (!supported()) {
    return 'passkeyUnsupported';
  }
  const options = await getAuth('/passkey/generate-register-options');
  if (options.status === 403 && options.body.error === 'stepUp') {
    // Adding one is among the riskiest actions (PLAN D23): the caller asks to confirm it's you first.
    return 'stepUp';
  }
  const optionsJSON = challenged<PublicKeyCredentialCreationOptionsJSON>(options.body);
  if (!options.ok || !optionsJSON) {
    return authError(options);
  }
  let response;
  try {
    response = await startRegistration({ optionsJSON });
  } catch (error) {
    return ceremonyError(error);
  }
  const verified = await postAuth('/passkey/verify-registration', {
    response,
    ...(name.trim() === '' ? {} : { name: name.trim() }),
  });
  return verified.ok ? undefined : authError(verified);
};
