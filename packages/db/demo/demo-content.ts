/**
 * Obviously fictional content for a demo site (PLAN R130): an election with three invented parties and four invented
 * criteria, two invented programmes, a few published ratings and the rest pending. It goes in through the real
 * triggers, as fictional members who exist only for this and are removed at the end, so the demo shows what the
 * platform does without a word of real political content.
 *
 * It fills only an active site whose country code is user-assigned (ISO 3166 XA–XZ, never a real country, and not
 * XK, which Kosovo uses) and that has no election yet: it can't put fictional content into a real site.
 *
 * First each programme's bytes go on the volume, in the site's `sources` bucket, the same day as the SQL runs:
 *
 *   node packages/db/demo/print.ts file a | kubectl exec -i deploy/aiontheballot-api -- \
 *     node dist/put-file.js <site-id> sources                     # then the same for b
 *   node packages/db/demo/print.ts sql demo                       # the SQL for the site `demo`, run as the owner
 */

/** The fictional programmes, stored as plain text: their bytes go on the volume, their sections are the units. */
export const DEMO_PROGRAMMES = {
  a: {
    party: 0,
    title: 'Programa de demostración del Partido Ejemplo A (texto inventado)',
    sections: [
      'El Partido Ejemplo A propone, en este texto inventado, una moratoria de ejemplo sobre los sistemas de prueba más avanzados.',
      'También propone, a modo de ejemplo, una agencia de supervisión ficticia con un presupuesto inventado.',
    ],
  },
  b: {
    party: 1,
    title: 'Programa de demostración del Partido Ejemplo B (texto inventado)',
    sections: [
      'El Partido Ejemplo B rechaza, en este programa inventado, cualquier límite de ejemplo a los sistemas de prueba.',
      'Propone, a modo de ejemplo, ayudas ficticias para una industria imaginaria.',
    ],
  },
} as const;

export type DemoProgramme = keyof typeof DEMO_PROGRAMMES;

/** A programme's bytes, exactly as put-file stores them and as the SQL hashes them. */
export const programmeText = (key: DemoProgramme): string =>
  DEMO_PROGRAMMES[key].sections.join('\n\n');

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** A SQL string literal: the content here is ours, but quoting it properly costs nothing. */
const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const json = (value: unknown): string => `${literal(JSON.stringify(value))}::jsonb`;

const PARTIES = [
  { slug: 'partido-ejemplo-a', name: 'Partido Ejemplo A', short: 'PEA', colour: '#2f6db5' },
  { slug: 'partido-ejemplo-b', name: 'Partido Ejemplo B', short: 'PEB', colour: '#8a3f9e' },
  { slug: 'partido-ejemplo-c', name: 'Partido Ejemplo C', short: 'PEC', colour: '#3f8a52' },
] as const;

const CRITERIA = [1, 2, 3, 4].map((n) => ({
  slug: `criterio-de-ejemplo-${n}`,
  title: { es: `Criterio de ejemplo ${n}`, en: `Example criterion ${n}` },
  short: { es: `Ejemplo ${n}`, en: `Example ${n}` },
  description: {
    es: `Descripción inventada del criterio de ejemplo ${n}, para la demostración.`,
    en: `An invented description of example criterion ${n}, for the demonstration.`,
  },
}));

/** The cells published, by party and criterion (indexes): a rating, its summary, and a quote or a checked document. */
const PUBLISHED = [
  {
    party: 0,
    criterion: 0,
    rating: 'meets',
    summary: {
      es: 'Resumen inventado: propone una moratoria de ejemplo.',
      en: 'An invented summary: it proposes an example moratorium.',
    },
    quote: {
      programme: 'a',
      text: 'una moratoria de ejemplo sobre los sistemas de prueba más avanzados',
    },
  },
  {
    party: 0,
    criterion: 1,
    rating: 'partially_meets',
    summary: {
      es: 'Resumen inventado: propone una agencia ficticia, sin más detalle.',
      en: 'An invented summary: it proposes a fictional agency, with no more detail.',
    },
    quote: {
      programme: 'a',
      text: 'una agencia de supervisión ficticia con un presupuesto inventado',
    },
  },
  {
    party: 1,
    criterion: 0,
    rating: 'does_not_meet',
    summary: {
      es: 'Resumen inventado: rechaza cualquier límite de ejemplo.',
      en: 'An invented summary: it rejects any example limit.',
    },
    quote: {
      programme: 'b',
      text: 'rechaza, en este programa inventado, cualquier límite de ejemplo',
    },
  },
  {
    party: 1,
    criterion: 2,
    rating: 'not_mentioned',
    summary: {
      es: 'Resumen inventado: su programa de ejemplo no trata este criterio.',
      en: 'An invented summary: its example programme does not cover this criterion.',
    },
    checked: 'b',
  },
] as const;

/** The same place on the scale for a site whose methodology is descriptive (BRIEF §3). */
const DESCRIPTIVE = {
  meets: 'green',
  partially_meets: 'yellow',
  does_not_meet: 'red',
  not_mentioned: 'not_mentioned',
} as const;

/** Fictional members, only for the triggers to act as; removed at the end. */
const ACTORS = {
  countryAdmin: '0190f8c4-de70-7000-8000-0000000000a1',
  editor: '0190f8c4-de70-7000-8000-0000000000a2',
  reviewer: '0190f8c4-de70-7000-8000-0000000000a3',
} as const;

/**
 * The SQL that fills the site `slug` with the demo content: one DO block, so it all goes in or nothing does. Run it as
 * the tables' owner, after putting both programmes' bytes on the volume with put-file (the stored copies its quotes
 * are checked against).
 */
export const demoContentSql = (slug: string): string => {
  if (!SLUG.test(slug)) {
    throw new Error(`${slug} is not a site's slug`);
  }
  const as = (user: string) => `PERFORM set_config('app.user_id', ${literal(user)}, true);`;
  const programmes = (Object.keys(DEMO_PROGRAMMES) as DemoProgramme[])
    .map((key) => {
      const programme = DEMO_PROGRAMMES[key];
      const text = programmeText(key);
      const units = programme.sections
        .map(
          (section, index) =>
            `INSERT INTO app.source_texts (source_document_id, tenant_id, unit_index, label, body)
         VALUES (d_sources[${programme.party + 1}], d_tenant, ${index + 1}, ${literal(`§ ${index + 1}`)}, ${literal(section)});`,
        )
        .join('\n    ');
      return `
    INSERT INTO app.files (tenant_id, bucket, content_type, byte_size, sha256, original_filename)
    VALUES (d_tenant, 'sources', 'text/plain', octet_length(convert_to(${literal(text)}, 'UTF8')),
            encode(sha256(convert_to(${literal(text)}, 'UTF8')), 'hex'), ${literal(`programa-de-ejemplo-${key}.txt`)})
    RETURNING id INTO d_file;
    INSERT INTO app.source_documents (tenant_id, election_id, party_id, kind, title, url, language, is_programme)
    VALUES (d_tenant, d_election, d_parties[${programme.party + 1}], 'web_page', ${literal(programme.title)},
            ${literal(`https://example.org/programa-de-ejemplo-${key}`)}, 'es', true)
    RETURNING id INTO d_created;
    d_sources[${programme.party + 1}] := d_created;
    UPDATE app.source_documents SET file_id = d_file, file_origin = 'uploaded' WHERE id = d_sources[${programme.party + 1}];
    ${units}
    UPDATE app.source_documents SET extraction_status = 'done' WHERE id = d_sources[${programme.party + 1}];`;
    })
    .join('\n');
  const cells = PUBLISHED.map((cell, index) => {
    const evidence =
      'quote' in cell
        ? `INSERT INTO app.draft_evidence (tenant_id, election_id, assessment_id, source_document_id, ordinal, quote)
       VALUES (d_tenant, d_election, d_cells[${index + 1}], d_sources[${DEMO_PROGRAMMES[cell.quote.programme].party + 1}], 1,
               ${literal(cell.quote.text)});`
        : `INSERT INTO app.draft_checked_documents (assessment_id, tenant_id, election_id, source_document_id)
       VALUES (d_cells[${index + 1}], d_tenant, d_election, d_sources[${DEMO_PROGRAMMES[cell.checked].party + 1}]);`;
    return `
    INSERT INTO app.assessments (tenant_id, election_id, party_id, criterion_id, draft_rating, draft_summary)
    VALUES (d_tenant, d_election, d_parties[${cell.party + 1}], d_criteria[${cell.criterion + 1}],
            (CASE d_kind WHEN 'demands' THEN ${literal(cell.rating)} ELSE ${literal(DESCRIPTIVE[cell.rating])} END)::app.rating,
            ${json(cell.summary)})
    RETURNING id INTO d_created;
    d_cells[${index + 1}] := d_created;
    ${evidence}`;
  }).join('\n');
  const reviews = PUBLISHED.map(
    (_cell, index) =>
      `UPDATE app.assessments SET state = 'in_review' WHERE id = d_cells[${index + 1}];`,
  ).join('\n    ');
  const publications = PUBLISHED.map(
    (_cell, index) =>
      `INSERT INTO app.assessment_revisions (assessment_id, reviewed_version)
     SELECT id, content_version FROM app.assessments WHERE id = d_cells[${index + 1}];`,
  ).join('\n    ');
  return `-- Fictional demo content for the site ${slug} (PLAN R130). Every name, quote and rating is invented.
DO $demo$
DECLARE
  site constant text := ${literal(slug)};
  d_tenant uuid;
  d_country text;
  d_default_locale text;
  d_kind app.methodology_kind;
  d_active boolean;
  d_operator uuid;
  d_election uuid;
  d_methodology uuid;
  d_file uuid;
  d_parties uuid[] := ARRAY[]::uuid[];
  d_criteria uuid[] := ARRAY[]::uuid[];
  d_sources uuid[] := ARRAY[NULL, NULL]::uuid[];
  d_cells uuid[] := ARRAY[]::uuid[];
  d_created uuid;
BEGIN
  SELECT t.id, t.country_code, t.default_locale, t.methodology_kind, t.active
    INTO d_tenant, d_country, d_default_locale, d_kind, d_active
    FROM app.tenants t WHERE t.slug = site;
  IF d_tenant IS NULL THEN
    RAISE EXCEPTION 'no site %', site;
  END IF;
  IF NOT d_active THEN
    RAISE EXCEPTION 'site % is not active: an election goes live only in an active site, so turn it on first', site;
  END IF;
  IF d_country !~ '^X[A-JL-Z]$' THEN
    RAISE EXCEPTION 'site % is in %, not a user-assigned country (XA-XZ but XK): demo content goes only into a demo site',
      site, d_country;
  END IF;
  IF d_default_locale NOT IN ('es', 'en') THEN
    RAISE EXCEPTION 'site %''s default language is %: the demo content is in Spanish and English', site, d_default_locale;
  END IF;
  IF EXISTS (SELECT 1 FROM app.elections e WHERE e.tenant_id = d_tenant) THEN
    RAISE EXCEPTION 'site % already has elections: the demo content fills only an empty site', site;
  END IF;
  SELECT o.organization_id INTO d_operator FROM app.tenant_organizations o WHERE o.tenant_id = d_tenant AND o.role = 'operator';
  IF d_operator IS NULL THEN
    RAISE EXCEPTION 'site % has no operator', site;
  END IF;

  -- Fictional members for the triggers to act as (removed at the end), at the second factor's level.
  PERFORM set_config('app.aal', '2', true);
  ${as(ACTORS.countryAdmin)}
  INSERT INTO app.memberships (user_id, tenant_id, role)
  VALUES (${literal(ACTORS.countryAdmin)}, d_tenant, 'country_admin'), (${literal(ACTORS.editor)}, d_tenant, 'editor'),
         (${literal(ACTORS.reviewer)}, d_tenant, 'reviewer');

  INSERT INTO app.elections (tenant_id, slug, type, name)
  VALUES (d_tenant, 'elecciones-de-demostracion', 'general',
          ${json({ es: 'Elecciones de demostración', en: 'Demonstration election' })})
  RETURNING id INTO d_election;
  INSERT INTO app.methodologies (tenant_id, election_id, kind, demands_owner_id, body)
  VALUES (d_tenant, d_election, d_kind, CASE WHEN d_kind = 'demands' THEN d_operator END,
          ${json({
            es: '## Metodología de demostración\n\nTodo en esta elección es **inventado**: los partidos, sus programas, los criterios y las valoraciones. Sirve para ver cómo funciona la plataforma.\n\n- Cada valoración enlaza a sus fuentes.\n- Cada cita se comprueba contra el texto guardado.',
            en: '## Demonstration methodology\n\nEverything in this election is **invented**: the parties, their programmes, the criteria and the ratings. It shows how the platform works.\n\n- Every rating links to its sources.\n- Every quote is checked against the stored text.',
          })})
  RETURNING id INTO d_methodology;
  INSERT INTO app.methodology_reviewers (tenant_id, methodology_id, name, affiliation)
  VALUES (d_tenant, d_methodology, 'Persona Revisora de Ejemplo', 'Universidad de Ejemplo');
${PARTIES.map(
  (
    party,
    index,
  ) => `  INSERT INTO app.parties (tenant_id, election_id, slug, name, short_name, colour, display_order)
  VALUES (d_tenant, d_election, ${literal(party.slug)}, ${json({ es: party.name, en: party.name })},
          ${json({ es: party.short, en: party.short })}, ${literal(party.colour)}, ${index + 1})
  RETURNING id INTO d_created;
  d_parties := d_parties || d_created;`,
).join('\n')}
${CRITERIA.map(
  (
    criterion,
    index,
  ) => `  INSERT INTO app.criteria (tenant_id, election_id, slug, title, short_title, description, display_order)
  VALUES (d_tenant, d_election, ${literal(criterion.slug)}, ${json(criterion.title)}, ${json(criterion.short)},
          ${json(criterion.description)}, ${index + 1})
  RETURNING id INTO d_created;
  d_criteria := d_criteria || d_created;`,
).join('\n')}
  UPDATE app.elections SET status = 'live' WHERE id = d_election;

  -- The programmes (their bytes put on the volume beforehand), then the cells, drafted, reviewed and published.
  ${as(ACTORS.editor)}${programmes}
  UPDATE app.parties SET programme_status = 'published' WHERE id IN (d_parties[1], d_parties[2]);
  UPDATE app.parties SET programme_status = 'pending' WHERE id = d_parties[3];
${cells}
    ${reviews}
  ${as(ACTORS.reviewer)}
    ${publications}

  -- The fictional members go: the content stays, credited to no account.
  DELETE FROM app.memberships m
   WHERE m.tenant_id = d_tenant AND m.user_id IN (${literal(ACTORS.countryAdmin)}, ${literal(ACTORS.editor)},
                                                ${literal(ACTORS.reviewer)});
  RAISE NOTICE 'Demo content in site %: 3 parties, 4 criteria, % published cells', site, ${PUBLISHED.length};
END
$demo$;
`;
};
