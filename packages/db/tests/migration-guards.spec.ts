import { resolveBinary } from 'dbmate';
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { migrationsDir, ownerUrl, superuserUrl } from './env.js';

const run = promisify(execFile);

/**
 * Migrations that refuse to lose data, run against a scratch database replayed up to just before them: the test
 * database is already past them. Merged migrations never change, so these stay valid.
 */
const SCRATCH = 'aiontheballot_migration_guards';

const inDatabase = (url: string, database: string): string => {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
};

const migrationsBefore = async (dir: string, name: string): Promise<string> => {
  const all = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
  const index = all.findIndex((file) => file.endsWith(`_${name}.sql`));
  if (index < 0) {
    throw new Error(`No migration named ${name}`);
  }
  for (const file of all.slice(0, index)) {
    await copyFile(join(migrationsDir, file), join(dir, file));
  }
  return all[index] as string;
};

/** Applies every migration in `dir`; resolves to dbmate's error output, or undefined if it succeeded. */
const migrate = async (dir: string): Promise<string | undefined> => {
  try {
    await run(resolveBinary(), [
      '--url',
      inDatabase(ownerUrl(), SCRATCH),
      '--migrations-dir',
      dir,
      '--no-dump-schema',
      'up',
    ]);
    return undefined;
  } catch (error) {
    return String((error as { stderr?: string }).stderr ?? error);
  }
};

const asOwner = async (sql: string): Promise<void> => {
  const client = new pg.Client({ connectionString: inDatabase(ownerUrl(), SCRATCH) });
  await client.connect();
  try {
    await client.query('BEGIN');
    // Nobody signed in: the nil UUID stands for the owner, as owner scripts do (PLAN R60).
    await client.query(
      `SELECT set_config('app.user_id', '00000000-0000-0000-0000-000000000000', true)`,
    );
    await client.query(sql);
    await client.query('COMMIT');
  } finally {
    await client.end();
  }
};

const superuser = async (sql: string): Promise<void> => {
  const client = new pg.Client({ connectionString: superuserUrl() });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
};

describe('files_on_volume', () => {
  let dir: string;
  let migration: string;

  beforeAll(async () => {
    await superuser(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
    await superuser(`CREATE DATABASE ${SCRATCH} OWNER aiontheballot_owner`);
    dir = await mkdtemp(join(tmpdir(), 'migration-guards-'));
    migration = await migrationsBefore(dir, 'files_on_volume');
    expect(await migrate(dir)).toBeUndefined();
    await copyFile(join(migrationsDir, migration), join(dir, migration));
    await asOwner(`
      INSERT INTO app.tenants (id, slug, country_code, default_locale, enabled_locales, display_name,
                               methodology_kind, report_retention_days)
      VALUES ('0190f8c4-5eed-7000-8000-0000000000aa', 'ejemplo-guarda', 'XA', 'es', '{es}',
              '{"es": "Inquilino de ejemplo"}', 'demands', 30)`);
  }, 120_000);

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
    await superuser(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
  });

  it("refuses to drop a stored file's bytes", async () => {
    await asOwner(`
      INSERT INTO app.files (id, tenant_id, bucket, content_type, byte_size, sha256)
      VALUES ('0190f8c4-5eed-7000-8000-0000000000ab', '0190f8c4-5eed-7000-8000-0000000000aa', 'sources',
              'application/pdf', 7, encode(sha256('\\x00010203040506'::bytea), 'hex'));
      INSERT INTO app.file_blobs (file_id, tenant_id, content)
      VALUES ('0190f8c4-5eed-7000-8000-0000000000ab', '0190f8c4-5eed-7000-8000-0000000000aa',
              '\\x00010203040506'::bytea)`);
    expect(await migrate(dir)).toContain(
      'would drop the bytes of 1 stored files and 0 brand assets',
    );
    await asOwner(`DELETE FROM app.files WHERE id = '0190f8c4-5eed-7000-8000-0000000000ab'`);
  }, 120_000);

  it("refuses to drop a brand asset's bytes", async () => {
    await asOwner(`
      INSERT INTO app.brand_assets (name, content_type, sha256, content)
      VALUES ('Marca de ejemplo', 'image/png', encode(sha256('\\x89504e47'::bytea), 'hex'), '\\x89504e47'::bytea)`);
    expect(await migrate(dir)).toContain(
      'would drop the bytes of 0 stored files and 1 brand assets',
    );
    await asOwner(`DELETE FROM app.brand_assets`);
  }, 120_000);

  it('runs once no bytes are stored in the database', async () => {
    expect(await migrate(dir)).toBeUndefined();
  }, 120_000);
});

describe('quote_normaliser_unicode', () => {
  let dir: string;
  let migration: string;
  const TENANT = '0190f8c4-5eed-7000-8000-0000000000ba';
  const ELECTION = '0190f8c4-5eed-7000-8000-0000000000bb';
  const SOURCE = '0190f8c4-5eed-7000-8000-0000000000bc';

  beforeAll(async () => {
    await superuser(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
    await superuser(`CREATE DATABASE ${SCRATCH} OWNER aiontheballot_owner`);
    dir = await mkdtemp(join(tmpdir(), 'migration-guards-'));
    migration = await migrationsBefore(dir, 'quote_normaliser_unicode');
    expect(await migrate(dir)).toBeUndefined();
    await copyFile(join(migrationsDir, migration), join(dir, migration));
    await asOwner(`
      INSERT INTO app.tenants (id, slug, country_code, default_locale, enabled_locales, display_name,
                               methodology_kind, report_retention_days)
      VALUES ('${TENANT}', 'ejemplo-guarda', 'XA', 'es', '{es}', '{"es": "Inquilino de ejemplo"}', 'demands', 30);
      INSERT INTO app.elections (id, tenant_id, slug, type, name)
      VALUES ('${ELECTION}', '${TENANT}', 'generales-de-ejemplo', 'general', '{"es": "Generales de ejemplo"}');
      INSERT INTO app.source_documents (id, tenant_id, election_id, kind, title, url)
      VALUES ('${SOURCE}', '${TENANT}', '${ELECTION}', 'web_page', 'Fuente de ejemplo',
              'https://example.org/fuente-de-ejemplo')`);
  }, 120_000);

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
    await superuser(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
  });

  it('refuses while a stored source text would normalise differently, its stored form then stale', async () => {
    // A byte-order mark, which the old normaliser kept. Put straight in, past extraction's rules: only the stored
    // text matters here.
    await asOwner(`
      ALTER TABLE app.source_texts DISABLE TRIGGER USER;
      INSERT INTO app.source_texts (source_document_id, tenant_id, unit_index, label, body)
      VALUES ('${SOURCE}', '${TENANT}', 1, '§ 1', U&'Texto\\FEFF de ejemplo');
      ALTER TABLE app.source_texts ENABLE TRIGGER USER`);
    expect(await migrate(dir)).toContain(
      '1 stored source texts or quotes would normalise differently',
    );
    await asOwner(`
      ALTER TABLE app.source_texts DISABLE TRIGGER USER;
      DELETE FROM app.source_texts WHERE source_document_id = '${SOURCE}';
      ALTER TABLE app.source_texts ENABLE TRIGGER USER`);
  }, 120_000);

  it('refuses while a stored quote would normalise differently', async () => {
    // A draft's quote with a byte-order mark, put straight in past the workflow's rules: only the stored quote matters.
    const tables = ['parties', 'criteria', 'assessments', 'draft_evidence'];
    await asOwner(`
      ${tables.map((t) => `ALTER TABLE app.${t} DISABLE TRIGGER USER;`).join('\n')}
      INSERT INTO app.parties (id, tenant_id, election_id, slug, name, short_name, display_order)
      VALUES ('0190f8c4-5eed-7000-8000-0000000000bd', '${TENANT}', '${ELECTION}', 'partido-ejemplo-a',
              '{"es": "Partido Ejemplo A"}', '{"es": "PEA"}', 1);
      INSERT INTO app.criteria (id, tenant_id, election_id, slug, title, description, display_order)
      VALUES ('0190f8c4-5eed-7000-8000-0000000000be', '${TENANT}', '${ELECTION}', 'criterio-de-ejemplo',
              '{"es": "Criterio de ejemplo"}', '{"es": "Un criterio inventado."}', 1);
      INSERT INTO app.assessments (id, tenant_id, election_id, party_id, criterion_id, updated_by)
      VALUES ('0190f8c4-5eed-7000-8000-0000000000bf', '${TENANT}', '${ELECTION}',
              '0190f8c4-5eed-7000-8000-0000000000bd', '0190f8c4-5eed-7000-8000-0000000000be',
              '00000000-0000-0000-0000-000000000000');
      INSERT INTO app.draft_evidence (tenant_id, election_id, assessment_id, source_document_id, ordinal, quote,
                                      created_by)
      VALUES ('${TENANT}', '${ELECTION}', '0190f8c4-5eed-7000-8000-0000000000bf', '${SOURCE}', 1,
              U&'Una cita de ejemplo\\FEFF lo bastante larga', '00000000-0000-0000-0000-000000000000');
      ${tables.map((t) => `ALTER TABLE app.${t} ENABLE TRIGGER USER;`).join('\n')}`);
    expect(await migrate(dir)).toContain(
      '1 stored source texts or quotes would normalise differently',
    );
    await asOwner(`
      ${tables.map((t) => `ALTER TABLE app.${t} DISABLE TRIGGER USER;`).join('\n')}
      DELETE FROM app.draft_evidence; DELETE FROM app.assessments; DELETE FROM app.criteria; DELETE FROM app.parties;
      ${tables.map((t) => `ALTER TABLE app.${t} ENABLE TRIGGER USER;`).join('\n')}`);
  }, 120_000);

  it('runs once every stored text normalises the same', async () => {
    await asOwner(`
      ALTER TABLE app.source_texts DISABLE TRIGGER USER;
      INSERT INTO app.source_texts (source_document_id, tenant_id, unit_index, label, body)
      VALUES ('${SOURCE}', '${TENANT}', 1, '§ 1', 'Texto de ejemplo');
      ALTER TABLE app.source_texts ENABLE TRIGGER USER`);
    expect(await migrate(dir)).toBeUndefined();
  }, 120_000);
});

describe('brand_asset_one_restriction', () => {
  let dir: string;
  let migration: string;
  /** One image's bytes, stored under `name`, restricted or not. */
  const asset = (name: string, restricted: boolean): string => `
    INSERT INTO app.brand_assets (name, restricted, content_type, sha256, byte_size)
    VALUES ('${name}', ${restricted}, 'image/png', encode(sha256('imagen de ejemplo'), 'hex'), 17)`;

  beforeAll(async () => {
    await superuser(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
    await superuser(`CREATE DATABASE ${SCRATCH} OWNER aiontheballot_owner`);
    dir = await mkdtemp(join(tmpdir(), 'migration-guards-'));
    migration = await migrationsBefore(dir, 'brand_asset_one_restriction');
    expect(await migrate(dir)).toBeUndefined();
    await copyFile(join(migrationsDir, migration), join(dir, migration));
  }, 120_000);

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
    await superuser(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
  });

  it('refuses while an image is stored both restricted and not, the rule it adds then broken', async () => {
    await asOwner(`
      ${asset('Marca restringida de ejemplo', true)};
      ${asset('Copia de ejemplo', false)}`);
    expect(await migrate(dir)).toContain(
      'brand_asset_one_restriction: 1 images are stored both restricted and not',
    );
    await asOwner(`DELETE FROM app.brand_assets WHERE restricted`);
  }, 120_000);

  it('runs once every image is stored one way, copies of the same restriction included', async () => {
    await asOwner(asset('Otra copia de ejemplo', false));
    expect(await migrate(dir)).toBeUndefined();
  }, 120_000);
});
