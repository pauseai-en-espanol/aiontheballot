import { createAuthPool } from '@aiontheballot/db/auth-pool';
import { createInterface } from 'node:readline/promises';

import { accountLink, findAccount } from './auth/accounts.js';
import { loadConfig } from './config.js';

/**
 * The owner's command for an account without an invitation (editorial workflow A1; PLAN R93): the first platform
 * admin, before invitations exist. Run inside an API pod, which has sign-in's settings, and never with `kubectl run`
 * (whose output the pod's log would keep):
 *
 *   kubectl exec -it deploy/aiontheballot-api -- node dist/create-account.js
 *
 * It asks for the email address, and the name of a new account, so neither appears in the command line (nor in the
 * cluster's audit log of it). It prints a single-use link, valid for an hour, to set the password, and the SQL that
 * makes the account a platform admin, for the owner to run once its person has signed in and enrolled TOTP. For an
 * account that exists but never got a password, it prints a new link instead. For one with a password and no second
 * factor, whose person forgot it (PLAN D19, R186), it asks for the address again and a typed confirmation, after the
 * identity check of incidents §5b, then prints a link that sets a new one. Never for an account with its second
 * factor, whose person resets their own. Nothing it prints is logged, and it prints no personal data.
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

const pool = createAuthPool({
  connectionString: settings.databaseUrl,
  maxConnections: 1,
  applicationName: 'aiontheballot-create-account',
});
const options = { ...settings, pool };

/** The link, and what to do with it. */
const printLink = (link: string) => {
  console.log('Its password is set at this link, once, within the hour:');
  console.log(`  ${link}`);
};

/** The owner's SQL that makes the account a platform admin, once it has enrolled TOTP. */
const printPlatformAdminSql = (userId: string) => {
  // The owner's SQL checks the order itself: it adds nothing until the account has enrolled TOTP.
  console.log(
    'Once its person has signed in and enrolled TOTP, this makes it a platform admin (as the database',
  );
  console.log('owner; it reports INSERT 0 1 when done, and INSERT 0 0 before enrolment):');
  console.log(
    `  INSERT INTO app.platform_admins (user_id) SELECT id FROM auth.users WHERE id = '${userId}' AND two_factor_enabled;`,
  );
};

try {
  const email = await ask('Email address: ');
  if (email === '') {
    fail('No answer: run it with kubectl exec -it, so it can ask');
  }
  const found = await findAccount(options, email);
  if (found?.enrolled) {
    fail(
      `Account ${found.userId} has a second factor: its person chooses a new password with "I forgot my password" ` +
        'on the sign-in page, or a reset email from Members; a lost authenticator is incidents §5a. Nothing was changed.',
    );
  } else if (!found || !found.hasPassword) {
    if (!found) {
      // A slip in a forgotten password's address lands here: say so before asking anything that makes an account.
      console.error('No account has this address: a new one is made, with this name.');
    }
    const name = found ? '' : await ask('Name (for a new account): ');
    const { userId, created, link } = await accountLink(options, { email, name });
    console.log(
      created ? `Account created: ${userId}` : `Account ${userId} has no password yet: a new link.`,
    );
    printLink(link);
    printPlatformAdminSql(userId);
  } else {
    // A forgotten password with no second factor (D19): the link alone opens the account, with every role it has, so
    // it goes only to its person, after the owner has checked who asks and what the account holds (incidents §5b).
    console.log(`Account ${found.userId} has a password and no second factor yet.`);
    console.log(
      'Before going on, run this as the owner, and confirm who asked (incidents §5b, steps 3 and 4):',
    );
    console.log(
      `  SELECT t.slug, m.role::text FROM app.memberships m JOIN app.tenants t ON t.id = m.tenant_id WHERE m.user_id = '${found.userId}'`,
    );
    console.log(
      `  UNION ALL SELECT 'platform', 'platform_admin' FROM app.platform_admins WHERE user_id = '${found.userId}';`,
    );
    console.error(
      'A link sets a new password, and whoever holds it gets the account and every role it has. Go on only once its\n' +
        'person has been confirmed as incidents §5b says, and give the link to them yourself, never through who asked.',
    );
    const again = await ask('The same address again: ');
    if (again.toLowerCase() !== email.toLowerCase()) {
      fail('The two addresses differ. Nothing was changed.');
    }
    const answer = await ask('Type "link" to make a link that sets a new password for it: ');
    if (answer !== 'link') {
      fail('Not confirmed. Nothing was changed.');
    }
    const { userId, link } = await accountLink(options, { email, name: '', reset: true });
    console.log(
      `Account ${userId}: a link for a new password. Its old password and sessions have ended, and any earlier link ` +
        'no longer works.',
    );
    printLink(link);
    console.log(
      'Give it to its person yourself, at a moment agreed with them, by a channel you know is theirs, never to the',
    );
    console.log(
      "account's email address. Setting the password emails the account a notice; at their next sign-in they enrol",
    );
    console.log('their authenticator.');
  }
} catch (error) {
  fail(error instanceof Error ? error.message : 'The account could not be created');
} finally {
  input.close();
  await pool.end();
}
