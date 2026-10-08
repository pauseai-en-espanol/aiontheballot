import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const envFile = `${root}.env`;
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env and run \`pnpm db:up\`.`);
  }
  return value;
};

/** ballot_owner on ballot_test: migrations run as the owner, as in production. */
export const ownerUrl = (): string => required('TEST_DATABASE_URL');

/** Superuser on ballot_test: tests switch to each runtime role with SET LOCAL ROLE. */
export const superuserUrl = (): string => required('TEST_SUPERUSER_DATABASE_URL');

export const migrationsDir = `${root}db/migrations`;
