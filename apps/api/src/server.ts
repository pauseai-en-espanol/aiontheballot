import { createAuthPool } from '@aiontheballot/db/auth-pool';
import { createDatabase } from '@aiontheballot/db/client';
import { createFileStore } from '@aiontheballot/db/file-store';
import { captureException } from '@sentry/node';

import { createInvitationSender } from './admin/invitations.js';
import { createProfileSource } from './admin/profiles.js';
import { buildApp } from './app.js';
import { createAuth } from './auth/auth.js';
import { createInvitedAccounts } from './auth/invited-accounts.js';
import { loadConfig } from './config.js';
import { createElectionSource } from './election-data.js';
import { initErrorTracking } from './error-tracking.js';
import { createBrandImageSource, createHomeSource } from './home-data.js';
import { createMailer, mailFailure } from './mail/mailer.js';
import { createRoutingSource } from './routing-data.js';
import { createSignups } from './signups.js';

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
// The platform's one sender (PLAN R115). Without it, nothing sends mail and no site offers its signup form.
const mailer = config.mail ? createMailer(config.mail) : undefined;
const signups =
  web && mailer
    ? createSignups({
        db: web,
        mailer,
        platformHost: config.platformHost,
        // Never the address or the message: only that sending failed, and the SMTP code (mailFailure); or that the
        // signup whose email failed couldn't be undone, and the database's error class.
        onMailError: (error, step) => {
          const code = (error as { code?: unknown }).code;
          const failure =
            step === 'send'
              ? mailFailure(error)
              : new Error(
                  `A signup whose email failed could not be undone: ${typeof code === 'string' ? code : 'unknown'}`,
                );
          console.error(failure.message);
          captureException(failure);
        },
      })
    : undefined;
const app = buildApp({
  logger: { level: config.logLevel },
  routing: web ? createRoutingSource(web) : undefined,
  home: web
    ? createHomeSource(web, { mail: signups !== undefined, platformHost: config.platformHost })
    : undefined,
  brandImages: web && files ? createBrandImageSource(web, files) : undefined,
  elections: web ? createElectionSource(web) : undefined,
  signups,
  admin: {
    auth:
      config.auth && authPool
        ? {
            auth: createAuth({ ...config.auth, pool: authPool }),
            adminOrigin: config.auth.adminOrigin,
          }
        : undefined,
    admin,
    profiles: authPool ? createProfileSource(authPool) : undefined,
    // Invitations need sign-in's accounts and the platform's sender (PLAN R114, R115).
    invitations:
      config.auth && authPool && mailer
        ? {
            accounts: createInvitedAccounts({ ...config.auth, pool: authPool }),
            send: createInvitationSender({
              mailer,
              adminOrigin: config.auth.adminOrigin,
              platformName: config.auth.totpIssuer,
            }),
          }
        : undefined,
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

// Unconfirmed signups are deleted 7 days after they were made (PLAN R119): every signup call deletes those due, and
// this hourly call does it on quiet days. Not a job: one DELETE through the database's own function.
const deleteExpiredSignups = (): void => {
  signups?.deleteExpired().catch((error: unknown) => {
    app.log.error({ err: error }, 'Could not delete expired signups');
    captureException(error);
  });
};
if (signups) {
  deleteExpiredSignups();
  setInterval(deleteExpiredSignups, 60 * 60 * 1000).unref();
}

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  app.log.info({ signal }, 'Shutting down');
  await app.close();
  // Emails still on their way go out (or their signups are undone) before the database pool closes.
  await signups?.settle(10_000);
  await web?.destroy();
  await admin?.destroy();
  await authPool?.end();
  process.exit(0);
};

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => void shutdown(signal));
}

await app.listen({ host: config.host, port: config.port });
