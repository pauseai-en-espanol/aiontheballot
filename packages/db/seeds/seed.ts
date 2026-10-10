/**
 * Fictional seed data for local development and the CI end-to-end stack (PLAN M1). Every name, hostname and country
 * code is invented (ISO 3166 user-assigned codes XA–XZ; `.localhost` hostnames, which browsers resolve to this
 * machine). Rows go in through the same triggers as in production, acting as a seed platform admin.
 *
 * Run with `pnpm db:seed` (DATABASE_URL, the owner's URL). It refuses to run unless the database is on this machine
 * and holds no tenant but its own, so it can never write into production; it does nothing if already seeded.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// A .ts path: Node runs this script as TypeScript, and doesn't map .js to .ts.
import { createFileStore, type FileStore } from '../src/file-store.ts';

const id = (block: number, n: number): string =>
  `0190f8c4-5eed-7000-8000-${block.toString().padStart(6, '0')}${n.toString().padStart(6, '0')}`;

export const SEED_USERS = {
  platformAdmin: id(1, 1),
  editorA: id(1, 2),
  reviewerA: id(1, 3),
  countryAdminA: id(1, 4),
  countryAdminB: id(1, 5),
  countryAdminInactive: id(1, 6),
} as const;

export interface SeedTenant {
  id: string;
  slug: string;
  country: string;
  locales: readonly string[];
  active: boolean;
  operator: string;
  /** hostname → [canonical, verified] */
  hostnames: Readonly<Record<string, readonly [boolean, boolean]>>;
}

export const SEED_TENANTS: Readonly<Record<'A' | 'B' | 'inactive', SeedTenant>> = {
  /** Reachable on its own hostname, with a verified alias and one awaiting verification. */
  A: {
    id: id(2, 1),
    slug: 'ejemplo-a',
    country: 'XA',
    locales: ['es'],
    active: true,
    operator: id(3, 1),
    hostnames: {
      'ejemplo-a.localhost': [true, true],
      'alias-a.localhost': [false, true],
      'pendiente-a.localhost': [false, false],
    },
  },
  /** Reachable only by path on the platform host, in two locales. */
  B: {
    id: id(2, 2),
    slug: 'ejemplo-b',
    country: 'XB',
    locales: ['es', 'en'],
    active: true,
    operator: id(3, 2),
    hostnames: {},
  },
  /** Inactive: its verified hostname must not be served. */
  inactive: {
    id: id(2, 3),
    slug: 'ejemplo-inactivo',
    country: 'XC',
    locales: ['es'],
    active: false,
    operator: id(3, 3),
    hostnames: { 'ejemplo-inactivo.localhost': [true, true] },
  },
};

/** Reserved for the platform (spec §3.1): the path-routing host and the admin host. */
export const SEED_PLATFORM_HOSTNAMES = ['plataforma.localhost', 'admin.localhost'] as const;

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Why seeding `databaseUrl` must not happen, or undefined when it may. The database must be on this machine (CI's
 * service container is too); production never is.
 */
export const refusal = (databaseUrl: string, env: NodeJS.ProcessEnv): string | undefined => {
  if (env.NODE_ENV === 'production') {
    return 'NODE_ENV is production';
  }
  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    return 'DATABASE_URL is not a URL';
  }
  return LOOPBACK.has(host) ? undefined : `the database host ${host} is not this machine`;
};

const ELECTION = id(4, 1);
const METHODOLOGY = id(4, 2);
const PARTIES = [id(4, 3), id(4, 4)] as const;
const CRITERIA = [id(4, 5), id(4, 6)] as const;
const FILE = id(4, 7);
const SOURCE = id(4, 8);
const CELLS = { published: id(4, 9), draft: id(4, 10) } as const;
/** B's drafts: one announced, one not (and sooner, so the coming-soon page would pick it if it leaked). */
const B_DRAFTS = { announced: id(5, 1), unannounced: id(5, 2) } as const;
/** A's uploaded operator logo: a fictional mark (two bars and a line, 240×64), not anyone's logo. */
const LOGO = {
  file: id(5, 3),
  png: 'iVBORw0KGgoAAAANSUhEUgAAAPAAAABACAYAAAAkn/rnAAAA60lEQVR4nO3ToQ2AQBAFUSjh+i/ySgAcjgQSxMB7Zt1+NesCZAkYwgQMYQKGMAFDmIAhTMAQJmAIW8cY23Fvm3Nexv/WX+AkYAgTMIQJGMIEDGEChjABQ5iAIUzAECZgCBMwhAkYwgQMYQKGMAFDmIAh7HMBP92FIgFDmIAhTMAQJmAIEzCECRjCBAxhAoYwAUOYgCFMwBAmYAgTMIQJGMIEDGGfCxj+RMAQJmAIEzCECRjCBAxhAoYwAUOYgCFMwBAmYAgTMIQJGMIEDGEChjABQ5hYIEzAECZgCBMwhAkYwgQMYQKGMAFD2A4/mJNwL4ieyQAAAABJRU5ErkJggg==',
} as const;
const LOGO_BYTES = Buffer.from(LOGO.png, 'base64');
/** A's site icon: a fictional mark (a white frame on teal, 512×512, the smallest a site icon may be). */
const ICON = {
  file: id(5, 4),
  png: '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AiBOAECXAGgTAHECALoEQJsAiBMA0CUA2gRAnACALgHQJgDiBAB0CYA2ARAnAKBLALQJgDgBAF0CoE0AxAkA6BIAbQIgTgBAlwBoEwBxAgC6BECbAIgTANAlANoEQJwAgC4B0CYA4gQAdAmANgEQJwCgSwC0CYA4AQBdAqBNAMQJAOgSAG0CIE4AQJcAaBMAcQIAugRAmwCIEwDQJQDaBECcAIAuAdAmAOIEAHQJgDYBECcAoEsAtAmAOAEAXQKgTQDECQDoEgBtAiBOAECXAGgTAHECALoEQJsAiBMA0CUA2gRAnACALgHQJgDiBAB0CYA2ARAnAKBLALQJgDgBAF0CoE0AxAkA6BIAbQIgTgBAlwBoEwBxAgC6BECbAIgTANAlANoEQJwAgC4B0CYA4gQAdAmANgEQJwCgSwC0CYA4AQBdAqBNAMQJAOgSAG0CIE4AQJcAaBMAcQIAugRAmwCIEwDQJQDaBECcAIAuAdAmAOIEAHQJgDYBECcAoEsAtAmAOAEAXQKgTQDECQDoEgBtAgAAggQAAAQJAAAIEgAAECQAACBIAABAkAAAgCABAABBAgAAggQAAAQJAAAIEgAAECQAACBIAABAkAAAgCABAABBAgAAggQAAAQJAAAIEgAAECQAACBIAABAkAAAgCABAABBAgAAggQAAAQJAAAIEgAAECQAACBIAABAkAAAgCABAABBAgAAggQAAAQJAAAIEgAAECQAACBIAABAkAAAgCABAABBAgAAggQAAAQJAAAIEgAAECQAACBIAABAkAAAgCABAABBAgAAggQAAAQJAAAIEgAAECQAACBIAABAkAAAgCABAABBAgAAggQAAAQJAAAIEgAAECQAACBIAABAkAAAgCABAABBAgAAggQAAAQJAAAIEgAAECQAACBIAABAkAAAgCABAABBAgAAggQAAAQJAAAIEgAAECQAACBIAABAkAAAgCABAABBAgAAggQAAAQJAAAIEgAAECQAACBIAABAkAAAgCABAABBAgAAggQAAAQJAAAIEgAAECQAACBIAABAkAAAgCABAABBAgAAggQAAAQJAAAIEgAAECQAACBIAABAkAAAgCABAABBAgAAggQAAAQJAAAIEgAAECQAACBIAABAkAAAgCABAABBAgAAggQAAAQJAAAIEgAAECQAACBIAABAkAAAgCABAABBAgAAggQAAAQJAAAIEgAAECQAACBIAABAkAAAgCABAABBA6ZtdHn9uT5XAAAAAElFTkSuQmCC',
} as const;
const ICON_BYTES = Buffer.from(ICON.png, 'base64');
/** Party A's programme: a stand-in for a PDF, enough for its stored copy and hash. */
const PROGRAMME = Buffer.from('programa de ejemplo');
const PAGES = [
  'El Partido Ejemplo A propone una moratoria ficticia sobre los sistemas de prueba más avanzados.',
  'También pide crear una agencia de supervisión de ejemplo, con un presupuesto inventado.',
];

/**
 * Seeds the database, inside the caller's transaction, connected as the owner. Returns 'already seeded' (and writes
 * no rows) if the seed tenants exist, and throws if any other tenant does.
 */
export const seed = async (
  client: pg.Client,
  /**
   * Where the seeds' file bytes go (ADR-0004: on the volume, under their tenant, bucket and hash); none, and only rows
   * are written. They are written even if the database is already seeded, so a lost folder comes back.
   */
  store?: FileStore,
): Promise<'seeded' | 'already seeded'> => {
  {
    const { rows } = await client.query<{ slug: string }>('SELECT slug FROM app.tenants');
    const ours = new Set(Object.values(SEED_TENANTS).map((t) => t.slug));
    const strangers = rows.filter((r) => !ours.has(r.slug));
    if (strangers.length > 0) {
      throw new Error(
        `Refusing to seed: the database holds other tenants (${strangers.map((r) => r.slug).join(', ')})`,
      );
    }
    // Bytes first, rows second: a row never names bytes the store lacks.
    if (store) {
      await store.put({ tenantId: SEED_TENANTS.A.id, bucket: 'sources' }, PROGRAMME);
      await store.put({ tenantId: SEED_TENANTS.A.id, bucket: 'public_assets' }, LOGO_BYTES);
      await store.put({ tenantId: SEED_TENANTS.A.id, bucket: 'public_assets' }, ICON_BYTES);
    }
    if (rows.length > 0) {
      return 'already seeded';
    }
    const as = (user: string) =>
      client.query(`SELECT set_config('app.user_id', $1, true), set_config('app.aal', '2', true)`, [
        user,
      ]);
    await as(SEED_USERS.platformAdmin);
    await client.query('INSERT INTO app.platform_admins (user_id) VALUES ($1)', [
      SEED_USERS.platformAdmin,
    ]);
    for (const hostname of SEED_PLATFORM_HOSTNAMES) {
      await client.query('INSERT INTO app.platform_hostnames (hostname) VALUES ($1)', [hostname]);
    }
    for (const [key, t] of Object.entries(SEED_TENANTS)) {
      await client.query(
        `INSERT INTO app.tenants (id, slug, country_code, default_locale, enabled_locales, display_name,
                                  methodology_kind, report_retention_days, active)
         VALUES ($1, $2, $3, 'es', $4, $5, 'demands', 365, $6)`,
        [
          t.id,
          t.slug,
          t.country,
          t.locales,
          { es: `Inquilino de ejemplo ${key}`, en: `Example tenant ${key}` },
          t.active,
        ],
      );
      // A's operator has a website, a contact address and a newsletter (on the reserved .example TLD); B's has none.
      const contact = key === 'A' ? `organizacion-${t.slug}.example` : undefined;
      await client.query(
        `INSERT INTO app.organizations (id, display_name, legal_name, url, contact_email, newsletter_url)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          t.operator,
          { es: `Organización de ejemplo ${key}`, en: `Example organisation ${key}` },
          `Organización de Ejemplo ${key}`,
          contact && `https://${contact}/`,
          contact && `contacto@${contact}`,
          contact && `https://boletin.${contact}/`,
        ],
      );
      await client.query(
        `INSERT INTO app.tenant_organizations (tenant_id, organization_id, role) VALUES ($1, $2, 'operator')`,
        [t.id, t.operator],
      );
      for (const [hostname, [canonical, verified]] of Object.entries(t.hostnames)) {
        await client.query(
          `INSERT INTO app.tenant_hostnames (hostname, tenant_id, is_canonical, verified_at)
           VALUES ($1, $2, $3, CASE WHEN $4 THEN now() END)`,
          [hostname, t.id, canonical, verified],
        );
      }
    }
    const A = SEED_TENANTS.A;
    for (const [user, tenant, role] of [
      [SEED_USERS.editorA, A.id, 'editor'],
      [SEED_USERS.reviewerA, A.id, 'reviewer'],
      [SEED_USERS.countryAdminA, A.id, 'country_admin'],
      [SEED_USERS.countryAdminB, SEED_TENANTS.B.id, 'country_admin'],
      [SEED_USERS.countryAdminInactive, SEED_TENANTS.inactive.id, 'country_admin'],
    ] as const) {
      await client.query(
        'INSERT INTO app.memberships (user_id, tenant_id, role) VALUES ($1, $2, $3)',
        [user, tenant, role],
      );
    }
    await client.query(
      `INSERT INTO app.tenant_documents (tenant_id, kind, body, published_at)
       VALUES ($1, 'privacy_policy', '{"es": "Política de privacidad de ejemplo."}', now())`,
      [A.id],
    );

    // A's live election: its structure, then live.
    await client.query(
      `INSERT INTO app.elections (id, tenant_id, slug, type, name) VALUES ($1, $2, 'generales-de-ejemplo', 'general', $3)`,
      [ELECTION, A.id, { es: 'Elecciones generales de ejemplo' }],
    );
    await client.query(
      `INSERT INTO app.methodologies (id, tenant_id, election_id, kind, demands_owner_id, body)
       VALUES ($1, $2, $3, 'demands', $4, '{"es": "Metodología de ejemplo, con demandas inventadas."}')`,
      [METHODOLOGY, A.id, ELECTION, A.operator],
    );
    await client.query(
      `INSERT INTO app.methodology_reviewers (tenant_id, methodology_id, name, affiliation)
       VALUES ($1, $2, 'Persona Revisora de Ejemplo', 'Universidad de Ejemplo')`,
      [A.id, METHODOLOGY],
    );
    for (const [i, party] of PARTIES.entries()) {
      const letter = i === 0 ? 'A' : 'B';
      await client.query(
        `INSERT INTO app.parties (id, tenant_id, election_id, slug, name, short_name, display_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          party,
          A.id,
          ELECTION,
          `partido-ejemplo-${letter.toLowerCase()}`,
          { es: `Partido Ejemplo ${letter}` },
          { es: `PE${letter}` },
          i + 1,
        ],
      );
    }
    for (const [i, criterion] of CRITERIA.entries()) {
      await client.query(
        `INSERT INTO app.criteria (id, tenant_id, election_id, slug, title, short_title, description, display_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          criterion,
          A.id,
          ELECTION,
          `criterio-de-ejemplo-${i + 1}`,
          { es: `Criterio de ejemplo ${i + 1}` },
          { es: `Ejemplo ${i + 1}` },
          { es: 'Descripción inventada de un criterio de ejemplo.' },
          i + 1,
        ],
      );
    }
    await client.query(`UPDATE app.elections SET status = 'live' WHERE id = $1`, [ELECTION]);

    // Party A's programme: uploaded by the editor, with its extracted pages.
    await as(SEED_USERS.editorA);
    await client.query(
      `INSERT INTO app.files (id, tenant_id, bucket, content_type, byte_size, sha256, original_filename)
       VALUES ($1, $2, 'sources', 'application/pdf', $3, encode(sha256($4), 'hex'), 'programa-de-ejemplo.pdf')`,
      [FILE, A.id, PROGRAMME.length, PROGRAMME],
    );
    await client.query(
      `INSERT INTO app.source_documents (id, tenant_id, election_id, party_id, kind, title, url, is_programme)
       VALUES ($1, $2, $3, $4, 'pdf', 'Programa de ejemplo', 'https://example.org/programa-de-ejemplo.pdf', true)`,
      [SOURCE, A.id, ELECTION, PARTIES[0]],
    );
    await client.query(
      `UPDATE app.source_documents SET file_id = $1, file_origin = 'uploaded' WHERE id = $2`,
      [FILE, SOURCE],
    );
    for (const [i, body] of PAGES.entries()) {
      await client.query(
        `INSERT INTO app.source_texts (source_document_id, tenant_id, unit_index, label, body)
         VALUES ($1, $2, $3, $4, $5)`,
        [SOURCE, A.id, i + 1, `p. ${i + 1}`, body],
      );
    }
    await client.query(`UPDATE app.source_documents SET extraction_status = 'done' WHERE id = $1`, [
      SOURCE,
    ]);

    // Two cells of party A: one published through the real flow, one left as a draft.
    await client.query(
      `INSERT INTO app.assessments (id, tenant_id, election_id, party_id, criterion_id, draft_rating, draft_summary)
       VALUES ($1, $2, $3, $4, $5, 'meets', '{"es": "Resumen inventado: propone una moratoria de ejemplo."}'),
              ($6, $2, $3, $4, $7, 'not_mentioned', '{"es": "Resumen inventado: no lo menciona."}')`,
      [CELLS.published, A.id, ELECTION, PARTIES[0], CRITERIA[0], CELLS.draft, CRITERIA[1]],
    );
    await client.query(
      `INSERT INTO app.draft_evidence (tenant_id, election_id, assessment_id, source_document_id, ordinal, quote)
       VALUES ($1, $2, $3, $4, 1, 'propone una moratoria ficticia sobre los sistemas de prueba')`,
      [A.id, ELECTION, CELLS.published, SOURCE],
    );
    await client.query(
      `INSERT INTO app.draft_checked_documents (assessment_id, tenant_id, election_id, source_document_id)
       VALUES ($1, $2, $3, $4)`,
      [CELLS.draft, A.id, ELECTION, SOURCE],
    );
    // A's operator logo, uploaded by its country admin and shown on the orange and on the white surfaces.
    await as(SEED_USERS.countryAdminA);
    await client.query(
      `INSERT INTO app.files (id, tenant_id, bucket, content_type, byte_size, sha256)
       VALUES ($1, $2, 'public_assets', 'image/png', $3, encode(sha256($4), 'hex'))`,
      [LOGO.file, A.id, LOGO_BYTES.byteLength, LOGO_BYTES],
    );
    for (const slot of ['operator_logo_on_accent', 'operator_logo_on_canvas']) {
      await client.query(
        'INSERT INTO app.tenant_brand_selections (tenant_id, slot, file_id) VALUES ($1, $2, $3)',
        [A.id, slot, LOGO.file],
      );
    }
    // And its own site icon; B has none, so its pages get the platform's default.
    await client.query(
      `INSERT INTO app.files (id, tenant_id, bucket, content_type, byte_size, sha256)
       VALUES ($1, $2, 'public_assets', 'image/png', $3, encode(sha256($4), 'hex'))`,
      [ICON.file, A.id, ICON_BYTES.byteLength, ICON_BYTES],
    );
    await client.query(
      `INSERT INTO app.tenant_brand_selections (tenant_id, slot, file_id) VALUES ($1, 'site_icon', $2)`,
      [A.id, ICON.file],
    );
    await as(SEED_USERS.editorA);
    await client.query(`UPDATE app.assessments SET state = 'in_review' WHERE id = $1`, [
      CELLS.published,
    ]);
    await as(SEED_USERS.reviewerA);
    await client.query(
      `INSERT INTO app.assessment_revisions (assessment_id, reviewed_version)
       SELECT id, content_version FROM app.assessments WHERE id = $1`,
      [CELLS.published],
    );
    // Dates relative to today, so they stay in the future: no date is written into the code.
    await as(SEED_USERS.countryAdminB);
    const B = SEED_TENANTS.B;
    await client.query(
      `INSERT INTO app.elections (id, tenant_id, slug, type, territory_code, name, election_date, announced)
       VALUES ($1, $2, 'autonomicas-de-ejemplo', 'regional', 'XB-01', $3, current_date + 400, true),
              ($4, $2, 'municipales-de-ejemplo', 'municipal', NULL, $5, current_date + 200, false)`,
      [
        B_DRAFTS.announced,
        B.id,
        { es: 'Elecciones autonómicas de ejemplo', en: 'Example regional election' },
        B_DRAFTS.unannounced,
        { es: 'Elecciones municipales de ejemplo', en: 'Example local election' },
      ],
    );
    return 'seeded';
  }
};

const main = async (): Promise<void> => {
  const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and run `pnpm db:up`.');
  }
  const refused = refusal(url, process.env);
  if (refused) {
    throw new Error(`Refusing to seed: ${refused}.`);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    // The API reads the same folder locally and in the e2e stack (FILES_ROOT, default .data/files).
    const root =
      process.env.FILES_ROOT || fileURLToPath(new URL('../../../.data/files', import.meta.url));
    const result = await seed(client, createFileStore(root));
    await client.query('COMMIT');
    console.log(`Seeds: ${result}.`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
