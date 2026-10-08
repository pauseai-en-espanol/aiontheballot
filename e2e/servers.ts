/**
 * Where the e2e run serves each app's production build. The ports stay clear of `pnpm dev` (3000-3002).
 */
export const PORTS = { web: 4100, api: 4101, admin: 4102 } as const;

export const WEB_URL = `http://127.0.0.1:${PORTS.web}`;
export const API_URL = `http://127.0.0.1:${PORTS.api}`;
export const ADMIN_URL = `http://127.0.0.1:${PORTS.admin}`;

/** Deliberately fictional: the real name comes from each deployment's configuration. */
export const PLATFORM_NAME = 'Plataforma de ejemplo';
