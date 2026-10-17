/**
 * Fills a demo site's draft election with invented content (PLAN R214), so the site shows a whole comparison: the
 * demonstration methodology, an invented programme for each party, and every cell rated, quoted and published through
 * the real triggers, as fictional members removed at the end. The election goes live.
 *
 * It is for a draft whose parties are obviously fictional ("Partido Ejemplo A", "B"…, DEMO_ELECTION_PARTIES of them) and
 * whose criteria are those the site set up for its demo, which it knows only by their slugs (DEMO_ELECTION_TOPICS): the
 * criteria's words are the site's, in the database, never here. Anything else, an election already filled, and a site
 * not in a user-assigned country are refused, so it can't rate a real party nor put invented content into a real site.
 *
 * First each programme's bytes go on the volume, in the site's `sources` bucket, the same day as the SQL runs:
 *
 *   for n in $(seq 1 11); do node packages/db/demo/print.ts programme $n | kubectl exec -i deploy/aiontheballot-api -- \
 *     node dist/put-file.js <site-id> sources; done
 *   node packages/db/demo/print.ts fill <site> <election>        # the SQL, run as the owner
 */
import { ACTORS, DEMO_METHODOLOGY, DESCRIPTIVE, json, literal, SLUG } from './demo-content.ts';

/** How many fictional parties the invented programmes are for, in their display order. */
export const DEMO_ELECTION_PARTIES = 11;

/**
 * The demo's criteria, by slug, in order, each with invented wording for a programme that meets it, mentions it without
 * measures, or rejects it. Topics only, in invented words; what meets a criterion is the site's own text.
 */
export const DEMO_ELECTION_TOPICS: Readonly<
  Record<string, { meets: string; mentions: string; rejects: string }>
> = {
  'riesgo-existencial': {
    meets: 'reconoce que la IA avanzada podría llegar a causar daños catastróficos a la humanidad',
    mentions: 'los riesgos graves de la IA avanzada',
    rejects: 'que la IA avanzada suponga un riesgo para la existencia humana',
  },
  'pausa-o-prohibicion': {
    meets: 'apoya una pausa internacional en el desarrollo de los sistemas de IA más avanzados',
    mentions: 'la conveniencia de frenar algunos desarrollos de IA',
    rejects: 'cualquier pausa o prohibición en el desarrollo de la IA',
  },
  'perdida-de-control': {
    meets:
      'propone prohibir la automejora de la IA sin supervisión humana y los sistemas que puedan escapar a todo control',
    mentions: 'la necesidad de poner límites a los sistemas de IA autónomos',
    rejects: 'cualquier prohibición sobre los sistemas de IA autónomos',
  },
  'agencia-internacional': {
    meets: 'propone impulsar una agencia internacional que regule la IA',
    mentions: 'una mayor cooperación internacional sobre la IA',
    rejects: 'crear organismos internacionales para regular la IA',
  },
  'investigacion-en-seguridad': {
    meets:
      'se compromete a financiar la investigación en seguridad de la IA en el país y en Europa',
    mentions: 'la investigación en seguridad de la IA',
    rejects: 'dedicar fondos públicos a la investigación en seguridad de la IA',
  },
  aesia: {
    meets:
      'propone dotar a la agencia nacional de supervisión de la IA de más competencias y medios',
    mentions: 'la agencia nacional de supervisión de la IA',
    rejects: 'ampliar las competencias de la agencia nacional de supervisión de la IA',
  },
  ciberataques: {
    meets:
      'propone un plan nacional ante ciberataques con IA que contemple caídas prolongadas de internet',
    mentions: 'el refuerzo de la ciberseguridad en general',
    rejects: 'un plan específico ante ciberataques con IA',
  },
  empleo: {
    meets: 'propone un plan ante una posible pérdida masiva de empleo por la automatización',
    mentions: 'el diálogo social sobre la IA en el trabajo',
    rejects: 'planes específicos ante la pérdida de empleo por la IA',
  },
  formacion: {
    meets: 'propone formar a la población en el uso responsable de la IA y en sus riesgos',
    mentions: 'la formación digital en IA',
    rejects: 'incluir los riesgos de la IA en la formación',
  },
  'centros-de-datos': {
    meets:
      'propone dar voz a las poblaciones afectadas y limitar los grandes centros de datos con criterios ambientales',
    mentions: 'el consumo energético de los centros de datos',
    rejects: 'limitar la instalación de grandes centros de datos',
  },
};

type Rating = 'meets' | 'partially_meets' | 'does_not_meet' | 'not_mentioned';
const RATINGS: readonly Rating[] = ['meets', 'partially_meets', 'does_not_meet', 'not_mentioned'];

/** Each cell's invented rating, spread so every party and every criterion gets several kinds. */
const ratingOf = (party: number, criterion: number): Rating =>
  RATINGS[(party + 2 * criterion + Math.floor(criterion / 3)) % RATINGS.length]!;

/** The sentence a programme says about a criterion, or none when it doesn't mention it. */
const sentenceOf = (
  rating: Rating,
  topic: (typeof DEMO_ELECTION_TOPICS)[string],
): string | undefined => {
  switch (rating) {
    case 'meets':
      return `Este partido inventado ${topic.meets}.`;
    case 'partially_meets':
      return `Este partido inventado menciona, sin concretar medidas, ${topic.mentions}.`;
    case 'does_not_meet':
      return `Este partido inventado rechaza ${topic.rejects}.`;
    case 'not_mentioned':
      return undefined;
  }
};

const SUMMARIES: Readonly<Record<Rating, { es: string; en: string }>> = {
  meets: {
    es: 'Resumen de demostración: el programa inventado de este partido cumple este punto.',
    en: "A demonstration summary: this party's invented programme meets this point.",
  },
  partially_meets: {
    es: 'Resumen de demostración: el programa inventado de este partido lo cumple en parte.',
    en: "A demonstration summary: this party's invented programme partly meets it.",
  },
  does_not_meet: {
    es: 'Resumen de demostración: el programa inventado de este partido no lo cumple.',
    en: "A demonstration summary: this party's invented programme does not meet it.",
  },
  not_mentioned: {
    es: 'Resumen de demostración: el programa inventado de este partido no lo menciona.',
    en: "A demonstration summary: this party's invented programme does not mention it.",
  },
};

/** The units of the `n`th party's invented programme (1-based, by display order). */
const programmeUnits = (n: number): string[] => {
  if (!Number.isInteger(n) || n < 1 || n > DEMO_ELECTION_PARTIES) {
    throw new Error(`There are ${DEMO_ELECTION_PARTIES} demo programmes, not ${n}`);
  }
  const sentences = Object.values(DEMO_ELECTION_TOPICS)
    .map((topic, criterion) => sentenceOf(ratingOf(n - 1, criterion), topic))
    .filter((sentence): sentence is string => sentence !== undefined);
  return [
    `Programa de demostración n.º ${n}. Todo este texto es inventado: no es el programa de ningún partido real.`,
    ...sentences,
  ];
};

/** A programme's bytes, exactly as put-file stores them and as the SQL hashes them. */
export const demoProgrammeText = (n: number): string => programmeUnits(n).join('\n\n');

/**
 * The SQL that fills the election `election` of the demo site `site`: one DO block, so it all goes in or nothing does.
 * Run it as the tables' owner, after putting every programme's bytes on the volume with put-file.
 */
export const demoElectionSql = (site: string, election: string): string => {
  if (!SLUG.test(site) || !SLUG.test(election)) {
    throw new Error(`${site} and ${election} must be a site's and an election's slugs`);
  }
  const as = (user: string) => `PERFORM set_config('app.user_id', ${literal(user)}, true);`;
  const slugs = Object.keys(DEMO_ELECTION_TOPICS);
  const programmes = Array.from({ length: DEMO_ELECTION_PARTIES }, (_, index) => {
    const n = index + 1;
    const text = demoProgrammeText(n);
    const units = programmeUnits(n)
      .map(
        (
          unit,
          u,
        ) => `INSERT INTO app.source_texts (source_document_id, tenant_id, unit_index, label, body)
    VALUES (d_sources[${n}], d_tenant, ${u + 1}, ${literal(`§ ${u + 1}`)}, ${literal(unit)});`,
      )
      .join('\n    ');
    return `
    INSERT INTO app.files (tenant_id, bucket, content_type, byte_size, sha256, original_filename)
    VALUES (d_tenant, 'sources', 'text/plain', octet_length(convert_to(${literal(text)}, 'UTF8')),
            encode(sha256(convert_to(${literal(text)}, 'UTF8')), 'hex'), ${literal(`programa-de-demostracion-${String(n).padStart(2, '0')}.txt`)})
    RETURNING id INTO d_file;
    INSERT INTO app.source_documents (tenant_id, election_id, party_id, kind, title, url, language, is_programme)
    VALUES (d_tenant, d_election, d_parties[${n}], 'web_page',
            ${literal(`Programa de demostración n.º ${n} (texto inventado)`)},
            ${literal(`https://example.org/programa-de-demostracion-${n}`)}, 'es', true)
    RETURNING id INTO d_created;
    d_sources[${n}] := d_created;
    UPDATE app.source_documents SET file_id = d_file, file_origin = 'uploaded' WHERE id = d_created;
    ${units}
    UPDATE app.source_documents SET extraction_status = 'done' WHERE id = d_created;`;
  }).join('\n');
  const cells: string[] = [];
  for (let p = 0; p < DEMO_ELECTION_PARTIES; p += 1) {
    for (const [c, slug] of slugs.entries()) {
      const rating = ratingOf(p, c);
      const sentence = sentenceOf(rating, DEMO_ELECTION_TOPICS[slug]!);
      const evidence =
        sentence === undefined
          ? `INSERT INTO app.draft_checked_documents (assessment_id, tenant_id, election_id, source_document_id)
    VALUES (d_created, d_tenant, d_election, d_sources[${p + 1}]);`
          : `INSERT INTO app.draft_evidence (tenant_id, election_id, assessment_id, source_document_id, ordinal, quote)
    VALUES (d_tenant, d_election, d_created, d_sources[${p + 1}], 1, ${literal(sentence.slice(0, -1))});`;
      cells.push(`
    INSERT INTO app.assessments (tenant_id, election_id, party_id, criterion_id, draft_rating, draft_summary)
    VALUES (d_tenant, d_election, d_parties[${p + 1}], d_criteria[${c + 1}],
            (CASE d_kind WHEN 'demands' THEN ${literal(rating)} ELSE ${literal(DESCRIPTIVE[rating])} END)::app.rating,
            ${json(SUMMARIES[rating])})
    RETURNING id INTO d_created;
    d_cells := d_cells || d_created;
    ${evidence}`);
    }
  }
  return `-- Invented demo content for the election ${election} of the site ${site} (PLAN R214). Every programme, quote and
-- rating is invented, for fictional parties.
DO $demo$
DECLARE
  site constant text := ${literal(site)};
  election_slug constant text := ${literal(election)};
  slugs constant text[] := ARRAY[${slugs.map(literal).join(', ')}];
  d_tenant uuid;
  d_country text;
  d_default_locale text;
  d_kind app.methodology_kind;
  d_active boolean;
  d_operator uuid;
  d_election uuid;
  d_status app.election_status;
  d_methodology uuid;
  d_file uuid;
  d_created uuid;
  d_slug text;
  d_parties uuid[];
  d_criteria uuid[] := ARRAY[]::uuid[];
  d_sources uuid[] := array_fill(NULL::uuid, ARRAY[${DEMO_ELECTION_PARTIES}]);
  d_cells uuid[] := ARRAY[]::uuid[];
  d_cell uuid;
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
  SELECT e.id, e.status INTO d_election, d_status FROM app.elections e WHERE e.tenant_id = d_tenant AND e.slug = election_slug;
  IF d_election IS NULL THEN
    RAISE EXCEPTION 'no election % in site %', election_slug, site;
  END IF;
  IF d_status <> 'draft'
     OR EXISTS (SELECT 1 FROM app.methodologies m WHERE m.election_id = d_election)
     OR EXISTS (SELECT 1 FROM app.source_documents s WHERE s.election_id = d_election)
     OR EXISTS (SELECT 1 FROM app.assessments a WHERE a.election_id = d_election) THEN
    RAISE EXCEPTION 'election % is not an untouched draft: only one with parties and criteria and nothing else is filled',
      election_slug;
  END IF;
  SELECT array_agg(p.id ORDER BY p.display_order) INTO d_parties FROM app.parties p WHERE p.election_id = d_election;
  IF coalesce(cardinality(d_parties), 0) <> ${DEMO_ELECTION_PARTIES} THEN
    RAISE EXCEPTION 'election % has % parties: the invented programmes are for ${DEMO_ELECTION_PARTIES}', election_slug,
      coalesce(cardinality(d_parties), 0);
  END IF;
  -- Invented ratings only for obviously fictional parties, in every language they are named in.
  IF EXISTS (SELECT 1 FROM app.parties p CROSS JOIN LATERAL jsonb_each_text(p.name) n
              WHERE p.election_id = d_election AND n.value !~ '^Partido Ejemplo [A-Z]$') THEN
    RAISE EXCEPTION 'election % has a party not named "Partido Ejemplo …": invented ratings go only to fictional parties',
      election_slug;
  END IF;
  IF (SELECT array_agg(c.slug::text ORDER BY c.slug) FROM app.criteria c WHERE c.election_id = d_election)
     IS DISTINCT FROM (SELECT array_agg(s ORDER BY s) FROM unnest(slugs) s) THEN
    RAISE EXCEPTION 'election %''s criteria are not the demo''s: %', election_slug, slugs;
  END IF;
  FOREACH d_slug IN ARRAY slugs LOOP
    SELECT c.id INTO d_created FROM app.criteria c WHERE c.election_id = d_election AND c.slug = d_slug;
    d_criteria := d_criteria || d_created;
  END LOOP;
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
  INSERT INTO app.methodologies (tenant_id, election_id, kind, demands_owner_id, body)
  VALUES (d_tenant, d_election, d_kind, CASE WHEN d_kind = 'demands' THEN d_operator END, ${json(DEMO_METHODOLOGY)})
  RETURNING id INTO d_methodology;
  INSERT INTO app.methodology_reviewers (tenant_id, methodology_id, name, affiliation)
  VALUES (d_tenant, d_methodology, 'Persona Revisora de Ejemplo', 'Universidad de Ejemplo');
  UPDATE app.elections SET status = 'live' WHERE id = d_election;

  -- The programmes (their bytes put on the volume beforehand), then every cell, drafted, reviewed and published.
  ${as(ACTORS.editor)}${programmes}
  UPDATE app.parties SET programme_status = 'published' WHERE election_id = d_election;
${cells.join('\n')}
  FOREACH d_cell IN ARRAY d_cells LOOP
    UPDATE app.assessments SET state = 'in_review' WHERE id = d_cell;
  END LOOP;
  ${as(ACTORS.reviewer)}
  FOREACH d_cell IN ARRAY d_cells LOOP
    INSERT INTO app.assessment_revisions (assessment_id, reviewed_version)
    SELECT id, content_version FROM app.assessments WHERE id = d_cell;
  END LOOP;

  -- The fictional members go: the content stays, credited to no account.
  DELETE FROM app.memberships m
   WHERE m.tenant_id = d_tenant AND m.user_id IN (${literal(ACTORS.countryAdmin)}, ${literal(ACTORS.editor)},
                                                ${literal(ACTORS.reviewer)});
  RAISE NOTICE 'Demo content in election % of site %: % parties, % criteria, % published cells', election_slug, site,
    ${DEMO_ELECTION_PARTIES}, cardinality(slugs), cardinality(d_cells);
END
$demo$;
`;
};
