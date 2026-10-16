import { createAuthPool } from '@aiontheballot/db/auth-pool';
import { createInterface } from 'node:readline/promises';

import { findAuthenticatorAccount, resetAuthenticator } from './auth/reset-authenticator.js';
import { loadConfig } from './config.js';

/**
 * The owner's reset of a lost authenticator (editorial workflow A5.4, ADR-0002 §10; runbook: incidents §5a), for a
 * member who has lost their authenticator and their backup codes. Run inside an API pod, and never with `kubectl run`
 * (whose output the pod's log would keep):
 *
 *   kubectl exec -it deploy/aiontheballot-api -- node dist/reset-authenticator.js
 *
 * It asks for the account's email address twice, so it never appears in the command line (nor in the cluster's audit
 * log of it) and a slip in it is caught, shows the account's id, whether it has an authenticator and how many sessions
 * are open, and asks to confirm.
 * Then it removes the authenticator and its backup codes and ends every session: at their next sign-in, with their
 * password, the member enrols a new authenticator. It prints no personal data: never the address or the name.
 */
const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const { auth } = loadConfig(process.env);
const settings =
  auth ??
  fail(
    'Sign-in is not configured here (ADMIN_ORIGIN, AUTH_DATABASE_URL, BETTER_AUTH_SECRET, PLATFORM_NAME)',
  );

// Questions go to standard error, so standard output holds only the result (create-account.ts reads them the same way).
const input = createInterface({ input: process.stdin });
const lines = input[Symbol.asyncIterator]();
const ask = async (question: string): Promise<string> => {
  process.stderr.write(question);
  const { value, done } = await lines.next();
  return done === true ? '' : String(value).trim();
};

const pool = createAuthPool({
  connectionString: settings.databaseUrl,
  maxConnections: 1,
  applicationName: 'aiontheballot-reset-authenticator',
});
try {
  const email = await ask('Email address of the account: ');
  if (email === '') {
    fail('No answer: run it with kubectl exec -it, so it can ask');
  }
  const again = await ask('The same address again: ');
  if (again.trim().toLowerCase() !== email.trim().toLowerCase()) {
    fail('The two addresses differ. Nothing was changed.');
  }
  const account = await findAuthenticatorAccount(pool, email);
  if (!account) {
    fail('No account has that email address. Nothing was changed.');
  } else if (!account.enrolled) {
    fail(
      `Account ${account.userId} has no authenticator: it enrols one at its next sign-in. Nothing was changed.`,
    );
  } else {
    console.log(
      `Account ${account.userId} has an authenticator and ${account.sessions} open session(s).`,
    );
    const answer = await ask(
      'Type "reset" to remove its authenticator and backup codes and end its sessions: ',
    );
    if (answer !== 'reset') {
      fail('Not confirmed. Nothing was changed.');
    }
    const outcome = await resetAuthenticator(pool, account.userId);
    if (outcome.kind === 'unknown') {
      fail('The account is gone. Nothing was changed.');
    } else if (outcome.kind === 'not-enrolled') {
      fail('The account has no authenticator any more. Nothing was changed.');
    } else {
      console.log(
        `Done: account ${account.userId} has no authenticator now, and ${outcome.sessions} session(s) ended.`,
      );
      console.log(
        'At their next sign-in, with their password, they enrol a new authenticator and get new backup codes.',
      );
    }
  }
} catch (error) {
  // A database fault is told by its class, never its message, which could quote what was asked.
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  const kind =
    typeof code !== 'string'
      ? ''
      : /^[0-9A-Z]{5}$/.test(code)
        ? ` (SQLSTATE ${code})`
        : ` (${code})`;
  // A connection lost as it committed may still have applied it: running it again says which.
  fail(`The reset failed${kind}, and may not have been applied: run it again to check.`);
} finally {
  input.close();
  await pool.end();
}
