import type pg from 'pg';

import {
  BRAND_ASSETS,
  CELLS,
  CORE_CRITERION,
  ELECTIONS,
  FILES,
  HOSTNAMES,
  INVITATION_TOKENS,
  JOBS,
  LLM_RUNS,
  MEMBERSHIPS,
  ORGANIZATIONS,
  PLATFORM_ADMINS,
  PLATFORM_HOSTNAME,
  REVOKED_INVITATION_TOKEN,
  REVOKED_MEMBERSHIPS,
  SOURCES,
  TENANT_DOCUMENTS,
  type TenantKey,
  TENANTS,
  TOMBSTONE_HOSTNAME,
  USERS,
  VERIFYING_HOSTNAME,
} from './matrix.js';

/** Fictional ISO 3166 user-assigned codes, one per fixture tenant. */
const COUNTRY: Readonly<Record<TenantKey, string>> = { A: 'XA', B: 'XB', inactive: 'XC' };

/**
 * Loads the matrix fixtures (ADR-0002, fixtures) into the freshly migrated test database, once per run. Rows go in
 * through the same triggers as in production, acting as the fixture platform admin; every test rolls back its own
 * changes, so the fixtures stay as they are.
 */
export const loadFixtures = async (client: pg.Client): Promise<void> => {
  await client.query('BEGIN');
  await client.query(
    `SELECT set_config('app.user_id', $1, true), set_config('app.aal', '2', true)`,
    [USERS.platformAdmin],
  );
  for (const userId of PLATFORM_ADMINS) {
    await client.query('INSERT INTO app.platform_admins (user_id) VALUES ($1)', [userId]);
  }
  for (const [key, tenant] of Object.entries(TENANTS) as [
    TenantKey,
    (typeof TENANTS)[TenantKey],
  ][]) {
    await client.query(
      `INSERT INTO app.tenants (id, slug, country_code, default_locale, enabled_locales, display_name,
                               methodology_kind, active, report_retention_days, llm_monthly_cap_usd)
       VALUES ($1, $2, $3, 'es', '{es}', $4, 'demands', $5, 365, 50)`,
      [tenant.id, tenant.slug, COUNTRY[key], { es: `Inquilino de prueba ${key}` }, tenant.active],
    );
  }
  for (const [key, asset] of Object.entries(BRAND_ASSETS)) {
    await client.query(
      `INSERT INTO app.brand_assets (id, name, restricted, content_type, sha256, content)
       VALUES ($1, $2, $3, 'image/png', encode(sha256($4::bytea), 'hex'), $4::bytea)`,
      [asset.id, `Marca de ejemplo ${key}`, asset.restricted, Buffer.from(`png-${key}`)],
    );
  }
  for (const [key, org] of Object.entries(ORGANIZATIONS)) {
    await client.query(
      `INSERT INTO app.organizations (id, display_name, legal_name, is_pauseai_chapter)
       VALUES ($1, $2, $3, $4)`,
      [
        org.id,
        { es: `Organización de ejemplo ${key}` },
        `Organización de Ejemplo ${key}`,
        org.pauseai,
      ],
    );
  }
  for (const key of Object.keys(TENANTS) as TenantKey[]) {
    await client.query(
      `INSERT INTO app.tenant_organizations (tenant_id, organization_id, role) VALUES ($1, $2, 'operator')`,
      [TENANTS[key].id, ORGANIZATIONS[key].id],
    );
    await client.query(
      `INSERT INTO app.tenant_brand_selections (tenant_id, slot, brand_asset_id) VALUES ($1, 'product_logo', $2)`,
      [TENANTS[key].id, BRAND_ASSETS.shared.id],
    );
  }
  await client.query(
    'INSERT INTO app.brand_asset_grants (brand_asset_id, tenant_id) VALUES ($1, $2)',
    [BRAND_ASSETS.restricted.id, TENANTS.A.id],
  );
  await client.query(
    `INSERT INTO app.tenant_brand_selections (tenant_id, slot, brand_asset_id) VALUES ($1, 'header_mark', $2)`,
    [TENANTS.A.id, BRAND_ASSETS.restricted.id],
  );
  for (const m of [...MEMBERSHIPS, ...REVOKED_MEMBERSHIPS]) {
    await client.query(
      'INSERT INTO app.memberships (user_id, tenant_id, role) VALUES ($1, $2, $3)',
      [m.user, TENANTS[m.tenant].id, m.role],
    );
  }
  for (const m of REVOKED_MEMBERSHIPS) {
    await client.query(
      'DELETE FROM app.memberships WHERE user_id = $1 AND tenant_id = $2 AND role = $3',
      [m.user, TENANTS[m.tenant].id, m.role],
    );
  }
  const invite = (tenant: TenantKey, token: string): Promise<unknown> =>
    client.query(
      `INSERT INTO app.invitations (tenant_id, email, role, token_hash, expires_at)
       VALUES ($1, $2, 'editor', encode(sha256($3::bytea), 'hex'), now() + interval '7 days')`,
      [TENANTS[tenant].id, `persona-invitada-${tenant.toLowerCase()}@example.org`, token],
    );
  for (const [key, token] of Object.entries(INVITATION_TOKENS) as [TenantKey, string][]) {
    await invite(key, token);
  }
  await invite('A', REVOKED_INVITATION_TOKEN);
  await client.query(
    `UPDATE app.invitations SET revoked_at = now() WHERE token_hash = encode(sha256($1::bytea), 'hex')`,
    [REVOKED_INVITATION_TOKEN],
  );
  await client.query('INSERT INTO app.platform_hostnames (hostname) VALUES ($1)', [
    PLATFORM_HOSTNAME,
  ]);
  for (const h of HOSTNAMES) {
    await client.query(
      `INSERT INTO app.tenant_hostnames (hostname, tenant_id, is_canonical, verified_at)
       VALUES ($1, $2, $3, CASE WHEN $4 THEN now() END)`,
      [h.hostname, TENANTS[h.tenant].id, h.canonical, h.verified],
    );
    if (h.retired) {
      await client.query('UPDATE app.tenant_hostnames SET retired_at = now() WHERE hostname = $1', [
        h.hostname,
      ]);
    }
  }
  await client.query(
    `INSERT INTO app.hostname_verifications (hostname, token_hash) VALUES ($1, encode(sha256('txt-a'), 'hex'))`,
    [VERIFYING_HOSTNAME],
  );
  await client.query('INSERT INTO app.hostname_tombstones (hostname) VALUES ($1)', [
    TOMBSTONE_HOSTNAME,
  ]);
  for (const doc of Object.values(TENANT_DOCUMENTS)) {
    await client.query(
      `INSERT INTO app.tenant_documents (id, tenant_id, kind, body, published_at)
       VALUES ($1, $2, 'privacy_policy', $3, CASE WHEN $4 THEN now() END)`,
      [doc.id, TENANTS[doc.tenant].id, { es: 'Política de privacidad de ejemplo' }, doc.published],
    );
  }
  // Files are uploaded by each tenant's author, so publishers are never their uploaders.
  for (const f of Object.values(FILES)) {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [CELLS[f.tenant].author]);
    await client.query(
      `INSERT INTO app.files (id, tenant_id, bucket, content_type, byte_size, sha256, original_filename)
       VALUES ($1, $2, $3, $4, octet_length(convert_to($5, 'UTF8')), encode(sha256(convert_to($5, 'UTF8')), 'hex'),
               'documento-de-ejemplo')`,
      [f.id, TENANTS[f.tenant].id, f.bucket, f.type, f.content],
    );
    if (f.blob) {
      await client.query(
        `INSERT INTO app.file_blobs (file_id, tenant_id, content) VALUES ($1, $2, convert_to($3, 'UTF8'))`,
        [f.id, TENANTS[f.tenant].id, f.content],
      );
    }
  }
  await client.query(`SELECT set_config('app.user_id', $1, true)`, [USERS.platformAdmin]);
  await client.query(
    `INSERT INTO app.core_criteria (id, key, title, description)
     VALUES ($1, 'criterio-comun-de-ejemplo', '{"es": "Criterio común de ejemplo"}', '{"es": "Descripción de ejemplo"}')`,
    [CORE_CRITERION],
  );
  // Each election starts as a draft, gets its structure, and only then goes live (and is archived).
  for (const e of Object.values(ELECTIONS)) {
    const tenant = TENANTS[e.tenant].id;
    await client.query(
      `INSERT INTO app.elections (id, tenant_id, slug, type, territory_code, name) VALUES ($1, $2, $3, $4, $5, $6)`,
      [e.id, tenant, e.slug, e.type, e.territory, { es: `Elecciones de ejemplo ${e.slug}` }],
    );
    if (!e.structure) {
      continue;
    }
    await client.query(
      `INSERT INTO app.methodologies (id, tenant_id, election_id, kind, demands_owner_id, body)
       VALUES ($1, $2, $3, 'demands', $4, '{"es": "Metodología de ejemplo"}')`,
      [e.methodology, tenant, e.id, ORGANIZATIONS[e.tenant].id],
    );
    await client.query(
      `INSERT INTO app.methodology_reviewers (id, tenant_id, methodology_id, name, affiliation)
       VALUES ($1, $2, $3, 'Persona Revisora de Ejemplo', 'Universidad de Ejemplo')`,
      [e.reviewer, tenant, e.methodology],
    );
    for (const [id, letter, order] of [
      [e.party, 'A', 1],
      [e.secondParty, 'B', 2],
    ] as const) {
      await client.query(
        `INSERT INTO app.parties (id, tenant_id, election_id, slug, name, short_name, display_order, logo_file_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          tenant,
          e.id,
          `partido-ejemplo-${letter.toLowerCase()}`,
          { es: `Partido Ejemplo ${letter}` },
          { es: `PE${letter}` },
          order,
          id === ELECTIONS.liveA.party ? FILES.logoA.id : null,
        ],
      );
    }
    await client.query(
      `INSERT INTO app.criteria (id, tenant_id, election_id, slug, title, short_title, description, display_order,
                                 core_criterion_id)
       VALUES ($1, $2, $3, 'criterio-de-ejemplo-1', '{"es": "Criterio de ejemplo 1"}', '{"es": "Ejemplo 1"}',
               '{"es": "Descripción de ejemplo"}', 1, $4)`,
      [e.criterion, tenant, e.id, e.id === ELECTIONS.liveA.id ? CORE_CRITERION : null],
    );
    await client.query(
      `INSERT INTO app.criteria (id, tenant_id, election_id, slug, title, short_title, description, display_order)
       VALUES ($1, $2, $3, 'criterio-de-ejemplo-2', '{"es": "Criterio de ejemplo 2"}', '{"es": "Ejemplo 2"}',
               '{"es": "Descripción de ejemplo"}', 2)`,
      [e.secondCriterion, tenant, e.id],
    );
    if (e.status !== 'draft') {
      // Only an active tenant's election goes live: the inactive tenant is active just for that moment.
      const inactive = !TENANTS[e.tenant].active;
      if (inactive) {
        await client.query('UPDATE app.tenants SET active = true WHERE id = $1', [tenant]);
      }
      await client.query(`UPDATE app.elections SET status = 'live' WHERE id = $1`, [e.id]);
      if (inactive) {
        await client.query('UPDATE app.tenants SET active = false WHERE id = $1', [tenant]);
      }
    }
    if (e.status === 'archived') {
      await client.query(`UPDATE app.elections SET status = 'archived' WHERE id = $1`, [e.id]);
    }
  }
  // Sources: created bare, then given their stored copy and their extracted text, as the worker will.
  for (const src of Object.values(SOURCES)) {
    const tenant = TENANTS[src.election.tenant].id;
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [
      CELLS[src.election.tenant].author,
    ]);
    await client.query(
      `INSERT INTO app.source_documents (id, tenant_id, election_id, party_id, kind, title, url, is_programme)
       VALUES ($1, $2, $3, $4, 'pdf', 'Programa de ejemplo', 'https://example.org/programa.pdf', $5)`,
      [src.id, tenant, src.election.id, src.party, src.party !== null],
    );
    if (src.file) {
      await client.query(
        `UPDATE app.source_documents SET file_id = $1, file_origin = 'uploaded' WHERE id = $2`,
        [src.file, src.id],
      );
      for (const [index, body] of src.pages.entries()) {
        await client.query(
          `INSERT INTO app.source_texts (source_document_id, tenant_id, unit_index, label, body)
           VALUES ($1, $2, $3, $4, $5)`,
          [src.id, tenant, index + 1, `p. ${index + 1}`, body],
        );
      }
      if (src.pages.length > 0) {
        await client.query(
          `UPDATE app.source_documents SET extraction_status = 'done' WHERE id = $1`,
          [src.id],
        );
      }
    }
  }
  await client.query(`SELECT set_config('app.user_id', $1, true)`, [USERS.platformAdmin]);
  for (const run of Object.values(LLM_RUNS)) {
    const tenant = TENANTS[run.election.tenant].id;
    await client.query(
      `INSERT INTO app.llm_runs (id, tenant_id, election_id, source_document_id, model, prompt_version)
       VALUES ($1, $2, $3, $4, 'modelo-de-ejemplo', 'v1')`,
      [run.id, tenant, run.election.id, run.source.id],
    );
    await client.query(
      `INSERT INTO app.llm_suggestions (id, tenant_id, election_id, run_id, party_id, criterion_id, suggested_rating,
                                        rationale, passages)
       VALUES ($1, $2, $3, $4, $5, $6, 'partially_meets', 'Razonamiento de ejemplo', '[]')`,
      [run.suggestion, tenant, run.election.id, run.id, run.election.party, run.election.criterion],
    );
  }
  for (const job of Object.values(JOBS)) {
    await client.query(
      `INSERT INTO app.job_requests (id, tenant_id, kind, source_document_id, llm_run_id) VALUES ($1, $2, $3, $4, $5)`,
      [job.id, TENANTS[job.source.election.tenant].id, job.kind, job.source.id, job.llmRun],
    );
    if (job.finished) {
      await client.query('UPDATE app.job_requests SET finished_at = now() WHERE id = $1', [job.id]);
    }
  }
  // Cells, written by each tenant's author (who becomes their contributor): a draft "not mentioned" backed by a
  // checked copy of the programme (with a quote too), and a "meets" with one quote, submitted for review.
  for (const [key, cells] of Object.entries(CELLS) as [TenantKey, (typeof CELLS)[TenantKey]][]) {
    const tenant = TENANTS[key].id;
    const e = cells.election;
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [cells.author]);
    await client.query(
      `INSERT INTO app.assessments (id, tenant_id, election_id, party_id, criterion_id, draft_rating, draft_summary)
       VALUES ($1, $2, $3, $4, $5, 'not_mentioned', '{"es": "Resumen de ejemplo"}'),
              ($6, $2, $3, $4, $7, 'meets', '{"es": "Resumen de ejemplo"}')`,
      [cells.draft, tenant, e.id, e.party, e.criterion, cells.review, e.secondCriterion],
    );
    await client.query(
      `INSERT INTO app.draft_checked_documents (assessment_id, tenant_id, election_id, source_document_id)
       VALUES ($1, $2, $3, $4)`,
      [cells.draft, tenant, e.id, cells.source.id],
    );
    await client.query(
      `INSERT INTO app.draft_evidence (id, tenant_id, election_id, assessment_id, source_document_id, ordinal, quote)
       VALUES ($1, $2, $3, $4, $5, 1, $6), ($7, $2, $3, $8, $5, 1, $6)`,
      [
        cells.evidence,
        tenant,
        e.id,
        cells.review,
        cells.source.id,
        cells.quote,
        cells.draftEvidence,
        cells.draft,
      ],
    );
    await client.query(`UPDATE app.assessments SET state = 'in_review' WHERE id = $1`, [
      cells.review,
    ]);
  }
  // A published cell per tenant, through the real flow: written by the author from a party-neutral document, submitted,
  // then published by someone else.
  for (const [key, cells] of Object.entries(CELLS) as [TenantKey, (typeof CELLS)[TenantKey]][]) {
    const tenant = TENANTS[key].id;
    const e = cells.election;
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [cells.author]);
    await client.query(
      `INSERT INTO app.assessments (id, tenant_id, election_id, party_id, criterion_id, draft_rating, draft_summary)
       VALUES ($1, $2, $3, $4, $5, 'partially_meets', '{"es": "Resumen de ejemplo publicado"}')`,
      [cells.published, tenant, e.id, e.secondParty, e.secondCriterion],
    );
    await client.query(
      `INSERT INTO app.draft_evidence (tenant_id, election_id, assessment_id, source_document_id, ordinal, quote)
       VALUES ($1, $2, $3, $4, 1, $5)`,
      [tenant, e.id, cells.published, cells.neutral.id, cells.publishedQuote],
    );
    await client.query(
      `INSERT INTO app.draft_checked_documents (assessment_id, tenant_id, election_id, source_document_id)
       VALUES ($1, $2, $3, $4)`,
      [cells.published, tenant, e.id, cells.neutral.id],
    );
    await client.query(`UPDATE app.assessments SET state = 'in_review' WHERE id = $1`, [
      cells.published,
    ]);
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [cells.publisher]);
    await client.query(
      `INSERT INTO app.assessment_revisions (assessment_id, reviewed_version)
       SELECT id, content_version FROM app.assessments WHERE id = $1`,
      [cells.published],
    );
  }
  // Change control in each live election: a reworded criterion, proposed by the author and approved (public through
  // structural_changes), and a pending reorder of the second criterion.
  for (const [key, cells] of Object.entries(CELLS) as [TenantKey, (typeof CELLS)[TenantKey]][]) {
    const tenant = TENANTS[key].id;
    const e = cells.election;
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [cells.author]);
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO app.change_requests (tenant_id, election_id, action, target_kind, target_id, field,
                                        proposed_value, public_note)
       VALUES ($1, $2, 'update', 'criterion', $3, 'description', '{"es": "Descripción de ejemplo revisada"}',
               '{"es": "Nota de ejemplo"}'),
              ($1, $2, 'update', 'criterion', $4, 'display_order', '3', '{"es": "Nota de ejemplo"}')
       RETURNING id`,
      [tenant, e.id, e.criterion, e.secondCriterion],
    );
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [cells.approver]);
    await client.query(`UPDATE app.change_requests SET state = 'approved' WHERE id = $1`, [
      rows[0]!.id,
    ]);
  }
  // Right-of-reply reports, one per tenant about its cell in review, sent as the public through app.submit_report (the
  // inactive tenant takes one only while active).
  for (const [key, tenant] of Object.entries(TENANTS) as [
    TenantKey,
    (typeof TENANTS)[TenantKey],
  ][]) {
    if (!tenant.active) {
      await client.query('UPDATE app.tenants SET active = true WHERE id = $1', [tenant.id]);
    }
    await client.query(
      `SELECT set_config('app.user_id', '', true), set_config('app.aal', '', true)`,
    );
    await client.query('SET LOCAL ROLE aiontheballot_web');
    await client.query(
      `SELECT app.submit_report(tenant => $1, kind => 'error_report', message => $2, election => $3,
                                assessment => $4, name => 'Persona de Ejemplo', email => $5)`,
      [
        tenant.id,
        `Mensaje de ejemplo sobre una celda de ${key}`,
        CELLS[key].election.id,
        CELLS[key].review,
        `persona-${key.toLowerCase()}@example.org`,
      ],
    );
    await client.query('RESET ROLE');
    await client.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.aal', '2', true)`,
      [USERS.platformAdmin],
    );
    if (!tenant.active) {
      await client.query('UPDATE app.tenants SET active = false WHERE id = $1', [tenant.id]);
    }
  }
  await client.query(`SELECT set_config('app.user_id', $1, true)`, [USERS.platformAdmin]);
  await client.query('COMMIT');
};
