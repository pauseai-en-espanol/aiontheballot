import { createAuthPool } from '@aiontheballot/db/auth-pool';
import { createDatabase, type Database } from '@aiontheballot/db/client';
import { createFileStore } from '@aiontheballot/db/file-store';
import { captureException, captureMessage, flush } from '@sentry/node';

import { createInvitationSender } from './admin/invitations.js';
import { createProfileSource } from './admin/profiles.js';
import { buildApp } from './app.js';
import { createArchiveDispatch } from './archive-dispatch.js';
import { createAuth } from './auth/auth.js';
import { createInvitedAccounts } from './auth/invited-accounts.js';
import { createMemberTokens } from './auth/member-tokens.js';
import { createPasswordLinks } from './auth/password-links.js';
import { createPasswordMail } from './auth/password-mail.js';
import { loadConfig } from './config.js';
import { logsInAs } from './database-roles.js';
import { createElectionSource } from './election-data.js';
import { API_TRACKING, initErrorTracking } from './error-tracking.js';
import { createExtractionDispatch } from './extraction-dispatch.js';
import { createFetcherClient } from './fetcher-client.js';
import { createBrandImageSource, createHomeSource } from './home-data.js';
import { createMailer, mailFailure } from './mail/mailer.js';
import { submitReport } from './reports.js';
import { createRevalidator } from './revalidator.js';
import { createRoutingSource } from './routing-data.js';
import { createSignups } from './signups.js';

const config = loadConfig(process.env);
initErrorTracking(config.sentryDsn, API_TRACKING);
// Public routes read as aiontheballot_web only (ADR-0003 §1).
const web = config.webDatabaseUrl
  ? createDatabase({
      connectionString: config.webDatabaseUrl,
      applicationName: 'aiontheballot-api-public',
    })
  : undefined;
const files = config.filesRoot ? createFileStore(config.filesRoot) : undefined;
// The admin's preview of a site reads as aiontheballot_preview, which also sees elections in preview (PLAN R181), and
// only for the web app's preview host, which sends the secret it shares with the admin.
const previewDb = config.preview
  ? createDatabase({
      connectionString: config.preview.databaseUrl,
      applicationName: 'aiontheballot-api-preview',
    })
  : undefined;
// The fetcher's refusals of the API itself (a secret it doesn't take, its own fault) are ours to hear.
const fetcher = config.fetcher
  ? createFetcherClient({
      ...config.fetcher,
      onError: (error) => {
        console.error(error.message);
        captureException(error);
      },
    })
  : undefined;
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
// Password recovery's mail (PLAN R170): links to choose a new password, and the notice once one is chosen. Without the
// platform's sender, no link is ever sent. A failure is reported without the address (mailFailure).
const passwordMail =
  config.auth && mailer
    ? createPasswordMail({
        mailer,
        adminOrigin: config.auth.adminOrigin,
        platformName: config.auth.totpIssuer,
      })
    : undefined;
const reportPasswordMail = (error: unknown): void => {
  const failure = mailFailure(error);
  console.error(failure.message);
  captureException(failure);
};
// Each login must be the role its routes assume (PLAN R181): one that isn't stops the server, before it listens unless
// the database is slow to answer, so it serves nothing it shouldn't. A database that can't be reached yet is checked again every 30 seconds until it can
// be; its routes fail meanwhile, as they would anyway.
const checkLogin = async (db: Database, role: string, variable: string): Promise<void> => {
  try {
    if (await logsInAs(db, role)) {
      return;
    }
  } catch (error) {
    console.error(`Could not check the login of ${variable}; trying again in 30 seconds`, error);
    setTimeout(() => void checkLogin(db, role, variable), 30_000).unref();
    return;
  }
  const error = new Error(`${variable} doesn't log in as ${role}: stopping`);
  console.error(error.message);
  captureException(error);
  await flush(2_000);
  process.exit(1);
};
const loginChecks: Promise<void>[] = [];
for (const [db, role, variable] of [
  [web, 'aiontheballot_web', 'WEB_DATABASE_URL'],
  [previewDb, 'aiontheballot_preview', 'PREVIEW_DATABASE_URL'],
  [admin, 'aiontheballot_admin', 'ADMIN_DATABASE_URL'],
] as const) {
  if (db) {
    loginChecks.push(checkLogin(db, role, variable));
  }
}

const app = buildApp({
  logger: { level: config.logLevel },
  routing: web ? createRoutingSource(web) : undefined,
  home: web
    ? createHomeSource(web, {
        mail: signups !== undefined,
        reports: config.reportsEnabled,
        platformHost: config.platformHost,
      })
    : undefined,
  brandImages: web && files ? createBrandImageSource(web, files) : undefined,
  elections: web ? createElectionSource(web) : undefined,
  preview:
    config.preview && previewDb
      ? {
          token: config.preview.token,
          // The site as the public will see it, its forms included: the admin's sandbox submits none (ADR-0005).
          home: createHomeSource(previewDb, {
            mail: signups !== undefined,
            reports: config.reportsEnabled,
            platformHost: config.platformHost,
            preview: true,
          }),
          elections: createElectionSource(previewDb, { preview: true }),
          brandImages: files ? createBrandImageSource(previewDb, files) : undefined,
        }
      : undefined,
  signups,
  // Only while their retention is enforced (the chart's daily anonymization): personal data is kept no longer.
  reports:
    web && config.reportsEnabled ? (slug, input) => submitReport(web, slug, input) : undefined,
  admin: {
    auth:
      config.auth && authPool
        ? {
            auth: createAuth({
              ...config.auth,
              pool: authPool,
              passwordMail,
              onMailError: reportPasswordMail,
            }),
            adminOrigin: config.auth.adminOrigin,
          }
        : undefined,
    admin,
    files,
    // The worker extracts what is uploaded (PLAN R116, ADR-0006); never the bytes or the text in a log, only that a
    // handover failed. One that may work later is logged and left for redelivery; one that won't is reported, and so
    // is a job that has waited far longer than any takes.
    extraction:
      config.worker && files
        ? createExtractionDispatch({
            workerUrl: config.worker.url,
            token: config.worker.token,
            files,
            onError: (error, transient) => {
              console.error(error.message);
              if (!transient) {
                captureException(error);
              }
            },
            // Together, at most every half hour per replica: a backlog is one report.
            onStale: (jobs) => {
              const oldestMinutes = Math.round(
                Math.max(...jobs.map((job) => job.waitedMs)) / 60_000,
              );
              const examples = jobs.slice(0, 5).map((job) => job.jobId);
              console.error(
                `${jobs.length} extraction jobs have waited too long, the oldest ${oldestMinutes} minutes: ${examples.join(', ')}`,
              );
              captureMessage('Extraction jobs have waited too long', {
                level: 'warning',
                extra: { jobs: jobs.length, oldestMinutes, examples },
              });
            },
          })
        : undefined,
    // Copies by URL and snapshots (ADR-0007): the fetcher alone reaches the internet. Snapshots need the worker too,
    // which records them; a missing one is a warning (W12), so only a handover that keeps failing is reported.
    fetcher,
    archives:
      fetcher && config.worker
        ? createArchiveDispatch({
            fetcher,
            workerUrl: config.worker.url,
            token: config.worker.token,
            archiveUrl: config.archiveUrl,
            onError: (error) => {
              console.error(error.message);
              captureException(error);
            },
          })
        : undefined,
    profiles: authPool ? createProfileSource(authPool) : undefined,
    // Members' tokens for tools (ADR-0008), checked and minted as Better Auth's role.
    tokens: authPool ? createMemberTokens(authPool) : undefined,
    passwordLinks:
      config.auth && authPool && passwordMail
        ? createPasswordLinks({ ...config.auth, pool: authPool, passwordMail })
        : undefined,
    // The public site's replicas, told at once when a site changes (R151); never what changed, only that it did.
    revalidate: config.webRevalidateUrl
      ? createRevalidator({
          url: config.webRevalidateUrl,
          onError: (error) => console.error(error.message),
        })
      : undefined,
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
  await previewDb?.destroy();
  await admin?.destroy();
  await authPool?.end();
  process.exit(0);
};

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => void shutdown(signal));
}

// At most 5 seconds: a database slow to answer never keeps the liveness probe waiting (the check goes on regardless).
await Promise.race([
  Promise.all(loginChecks),
  new Promise((resolve) => setTimeout(resolve, 5_000).unref()),
]);
await app.listen({ host: config.host, port: config.port });
