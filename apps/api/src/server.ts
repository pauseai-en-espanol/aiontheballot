import { createDatabase } from '@aiontheballot/db/client';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { initErrorTracking } from './error-tracking.js';
import { createHomeSource } from './home-data.js';
import { createRoutingSource } from './routing-data.js';

const config = loadConfig(process.env);
initErrorTracking(config.sentryDsn);
// Public routes read as aiontheballot_web only (ADR-0003 §1).
const web = config.webDatabaseUrl
  ? createDatabase({
      connectionString: config.webDatabaseUrl,
      applicationName: 'aiontheballot-api-public',
    })
  : undefined;
const app = buildApp({
  logger: { level: config.logLevel },
  routing: web ? createRoutingSource(web) : undefined,
  home: web ? createHomeSource(web) : undefined,
});

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  app.log.info({ signal }, 'Shutting down');
  await app.close();
  await web?.destroy();
  process.exit(0);
};

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => void shutdown(signal));
}

await app.listen({ host: config.host, port: config.port });
