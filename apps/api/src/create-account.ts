import { createAuthPool } from '@aiontheballot/db/auth-pool';
import { createInterface } from 'node:readline/promises';

import { accountLink } from './auth/accounts.js';
import { loadConfig } from './config.js';

/**
 * The owner's command for an account without an invitation (editorial workflow A1; PLAN R93): the first platform
 * admin, before invitations exist. Run inside an API pod, which has sign-in's settings, and never with `kubectl run`
 * (whose output the pod's log would keep):
 *
 *   kubectl exec -it deploy/aiontheballot-api -- node dist/create-account.js
 *
 * It asks for the email address and the name, so neither appears in the command line (nor in the cluster's audit log
 * of it). It prints a single-use link, valid for an hour, to set the password, and the SQL that makes the account a
 * platform admin, for the owner to run once its person has signed in and enrolled TOTP. For an account that exists but
 * never got a password, it prints a new link instead. Nothing it prints is logged.
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

// Questions go to standard error, so standard output holds only the result. Lines are read through the iterator,
// which keeps those that arrive together (piped input) instead of dropping all but the first.
const input = createInterface({ input: process.stdin });
const lines = input[Symbol.asyncIterator]();
const ask = async (question: string): Promise<string> => {
  process.stderr.write(question);
  const { value, done } = await lines.next();
  return done === true ? '' : String(value).trim();
};
const email = await ask('Email address: ');
const name = await ask('Name (for a new account): ');
input.close();
if (email === '') {
  fail('No answer: run it with kubectl exec -it, so it can ask');
}

const pool = createAuthPool({
  connectionString: settings.databaseUrl,
  maxConnections: 1,
  applicationName: 'aiontheballot-create-account',
});
try {
  const { userId, created, link } = await accountLink({ ...settings, pool }, { email, name });
  console.log(
    created ? `Account created: ${userId}` : `Account ${userId} has no password yet: a new link.`,
  );
  console.log('Its password is set at this link, once, within the hour:');
  console.log(`  ${link}`);
  // The owner's SQL checks the order itself: it adds nothing until the account has enrolled TOTP.
  console.log(
    'Once its person has signed in and enrolled TOTP, this makes it a platform admin (as the database',
  );
  console.log('owner; it reports INSERT 0 1 when done, and INSERT 0 0 before enrolment):');
  console.log(
    `  INSERT INTO app.platform_admins (user_id) SELECT id FROM auth.users WHERE id = '${userId}' AND two_factor_enabled;`,
  );
} catch (error) {
  fail(error instanceof Error ? error.message : 'The account could not be created');
} finally {
  await pool.end();
}
