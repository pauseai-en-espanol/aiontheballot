import { type Dsn, readDsn } from '@aiontheballot/observability/dsn';

export interface ApiConfig {
  host: string;
  port: number;
  logLevel: string;
  /** GlitchTip project for the API (in-cluster Service); undefined turns error tracking off. */
  sentryDsn: Dsn | undefined;
  /**
   * The read-only aiontheballot_web role's connection, for public routes (ADR-0003 §1). Undefined leaves them
   * unavailable (503) rather than failing the whole API.
   */
  webDatabaseUrl: string | undefined;
  /**
   * Where stored files' bytes live (ADR-0001: a persistent volume, under their SHA-256). Undefined leaves the routes
   * that serve them unavailable (503).
   */
  filesRoot: string | undefined;
}

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

/** Reads the API configuration from the environment, failing fast on invalid values. */
export const loadConfig = (env: NodeJS.ProcessEnv): ApiConfig => {
  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PORT must be an integer between 1 and 65535, got "${env.PORT}"`);
  }
  const logLevel = env.LOG_LEVEL ?? 'info';
  if (!LOG_LEVELS.includes(logLevel)) {
    throw new Error(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}, got "${logLevel}"`);
  }
  return {
    host: env.HOST ?? '0.0.0.0',
    port,
    logLevel,
    sentryDsn: readDsn(env),
    webDatabaseUrl: env.WEB_DATABASE_URL || undefined,
    filesRoot: env.FILES_ROOT || undefined,
  };
};
