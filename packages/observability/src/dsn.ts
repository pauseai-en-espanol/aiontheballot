/** A Sentry DSN, split into what the SDKs and the relay need. */
export interface Dsn {
  /** The DSN as configured. */
  value: string;
  publicKey: string;
  projectId: string;
  /** Where envelopes are posted, with the public key in the query string as Sentry's protocol expects. */
  envelopeUrl: string;
}

/**
 * Parses a DSN such as `http://<key>@glitchtip-web.glitchtip.svc.cluster.local/<project>`. Errors name the variable
 * but never echo its value: a DSN lets anyone who reaches GlitchTip post events, so it stays out of logs. (Sentry's
 * own parser prints invalid DSNs to the console, which is why it isn't used here.)
 */
export const parseDsn = (value: string, name = 'SENTRY_DSN'): Dsn => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} is not a valid URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} must use http or https`);
  }
  const publicKey = decodeURIComponent(url.username);
  if (!publicKey || url.password) {
    throw new Error(`${name} must carry a public key and no secret key`);
  }
  const segments = url.pathname.split('/').filter(Boolean);
  const projectId = segments.pop();
  if (!projectId || !/^\d+$/.test(projectId) || url.search || url.hash) {
    throw new Error(`${name} must end in a numeric project id, with no query or fragment`);
  }
  const prefix = segments.length > 0 ? `/${segments.join('/')}` : '';
  const query = new URLSearchParams({ sentry_version: '7', sentry_key: publicKey });
  return {
    value,
    publicKey,
    projectId,
    envelopeUrl: `${url.protocol}//${url.host}${prefix}/api/${projectId}/envelope/?${query.toString()}`,
  };
};

/** Reads `SENTRY_DSN`. Unset or empty means error tracking is off, as in local development and CI. */
export const readDsn = (env: Readonly<Record<string, string | undefined>>): Dsn | undefined => {
  const value = env.SENTRY_DSN?.trim();
  return value ? parseDsn(value) : undefined;
};
