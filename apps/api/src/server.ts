import { createAuthPool } from '@aiontheballot/db/auth-pool';
import { createDatabase } from '@aiontheballot/db/client';
import { createFileStore } from '@aiontheballot/db/file-store';
import { captureException } from '@sentry/node';

import { buildApp } from './app.js';
import { createAuth } from './auth/auth.js';
import { loadConfig } from './config.js';
import { initErrorTracking } from './error-tracking.js';
import { createBrandImageSource, createHomeSource } from './home-data.js';
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
const files = config.filesRoot ? createFileStore(config.filesRoot) : undefined;
// Sign-in runs as aiontheballot_auth, which reaches only Better Auth's tables; what a signed-in user does runs as
// aiontheballot_admin, through withActor (ADR-0002 §2, §3).
const authPool = config.auth
  ? createAuthPool({
      connectionString: config.auth.databaseUrl,
      applicationName: 'aiontheballot-api-auth',
    })
  : undefined;
const admin = config.adminDatabaseUrl
  ? createDatabase({
      connectionString: config.adminDatabaseUrl,
      applicationName: 'aiontheballot-api-admin',
    })
  : undefined;
const app = buildApp({
  logger: { level: config.logLevel },
  routing: web ? createRoutingSource(web) : undefined,
  home: web ? createHomeSource(web) : undefined,
  brandImages: web && files ? createBrandImageSource(web, files) : undefined,
  admin: {
    auth:
      config.auth && authPool
        ? {
            auth: createAuth({ ...config.auth, pool: authPool }),
            adminOrigin: config.auth.adminOrigin,
          }
        : undefined,
    admin,
  },
});

// Says at startup whether stored files can be written, so a volume mounted without write access shows in the logs
// (and in GlitchTip) at once. It never stops the API: routing and the home data don't need the volume.
if (files) {
  try {
    await files.probe();
    // A write cut off by a crash leaves its temporary file behind; one older than a day is no write in progress.
    const removed = await files.removeStaleTemporaryFiles(24 * 60 * 60 * 1000);
    app.log.info({ filesRoot: config.filesRoot, removed }, 'File store is writable');
  } catch (error) {
    app.log.error({ err: error, filesRoot: config.filesRoot }, 'File store is not writable');
    captureException(error);
  }
}

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  app.log.info({ signal }, 'Shutting down');
  await app.close();
  await web?.destroy();
  await admin?.destroy();
  await authPool?.end();
  process.exit(0);
};

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => void shutdown(signal));
}

await app.listen({ host: config.host, port: config.port });
