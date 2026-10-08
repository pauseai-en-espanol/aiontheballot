export interface ApiConfig {
  host: string;
  port: number;
  logLevel: string;
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
  return { host: env.HOST ?? '0.0.0.0', port, logLevel };
};
