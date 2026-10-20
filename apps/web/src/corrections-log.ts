import type { Localized } from '@aiontheballot/domain/localized';
import type { Rating } from '@aiontheballot/domain/methodology';
import type {
  PublicCriterion,
  PublicElection,
  PublicParty,
  PublicStructuralChange,
} from '@aiontheballot/domain/public-election';

/**
 * An election's public corrections log (BRIEF §4; editorial workflow H1.4; PLAN R150): every published revision of a
 * cell after its first (an update, a correction or a withdrawal, each with its public note), and every approved change
 * to the election's structure (CR1.8), newest first. A cell's first rating isn't a correction. Retired parties' and
 * criteria's cells are left out, as everywhere on the public site; their structural changes stay, being public acts.
 */
export type CorrectionEntry =
  | {
      kind: 'revision';
      at: string;
      party: PublicParty;
      criterion: PublicCriterion;
      change: 'update' | 'correction' | 'withdrawal';
      revisionNo: number;
      rating: Rating | null;
      note: Localized | null;
    }
  | { kind: 'structure'; at: string; change: PublicStructuralChange };

export const correctionsLog = ({
  parties,
  criteria,
  cells,
  changes = [],
}: PublicElection): CorrectionEntry[] => {
  const partyById = new Map(parties.map((party) => [party.id, party]));
  const criterionById = new Map(criteria.map((criterion) => [criterion.id, criterion]));
  const revisions = cells.flatMap((cell): CorrectionEntry[] => {
    const party = partyById.get(cell.partyId);
    const criterion = criterionById.get(cell.criterionId);
    if (!party || !criterion) {
      return [];
    }
    return cell.revisions.flatMap((revision): CorrectionEntry[] =>
      revision.changeKind === 'initial'
        ? []
        : [
            {
              kind: 'revision',
              at: revision.publishedAt,
              party,
              criterion,
              change: revision.changeKind,
              revisionNo: revision.revisionNo,
              rating: revision.rating,
              note: revision.publicNote,
            },
          ],
    );
  });
  const structure = changes.map((change): CorrectionEntry => ({
    kind: 'structure',
    at: change.approvedAt,
    change,
  }));
  return [...revisions, ...structure].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
};

/** The fields whose values the log shows; others (long texts, ids, an order) say only that they changed. */
export const SHOWN_VALUES: ReadonlySet<string> = new Set([
  'name',
  'short_name',
  'title',
  'short_title',
  'website',
  'election_date',
  'affiliation',
  'colour',
  'territory_codes',
]);

/** The order the log names a set's fields in (the admin's forms' order); one it doesn't know goes last. */
export const FIELD_ORDER = [
  'name',
  'short_name',
  'title',
  'short_title',
  'description',
  'logo_file_id',
  'colour',
  'website',
  'territory_codes',
  'election_date',
  'intro',
  'body',
  'admissible_source_kinds',
  'not_mentioned_source_kinds',
  'affiliation',
  'demands_owner_id',
  'display_order',
  'core_criterion_id',
] as const;

/** One field an update changed: its values, and whether the log shows them (else only that it changed). */
export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
  shown: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Whether the log shows a field's before and after: a short field, never of an external reviewer, whose name and
 * affiliation are personal data (R26), named only while the methodology names them (the API sends no values for them
 * anyway).
 */
const showsField = (change: PublicStructuralChange, field: string): boolean =>
  change.targetKind !== 'methodology_reviewer' && SHOWN_VALUES.has(field);

/**
 * The fields an update changed, in the log's order: its one field, or each of a set's (PLAN R183), which the API
 * names (`fields`) even where it sends no values.
 */
export const fieldChanges = (change: PublicStructuralChange): FieldChange[] => {
  if (change.action !== 'update') {
    return [];
  }
  if (change.field !== null) {
    return [
      {
        field: change.field,
        before: change.previousValue,
        after: change.newValue,
        shown: showsField(change, change.field),
      },
    ];
  }
  const before = isRecord(change.previousValue) ? change.previousValue : {};
  const after = isRecord(change.newValue) ? change.newValue : {};
  const rank = (field: string) => {
    const at = (FIELD_ORDER as readonly string[]).indexOf(field);
    return at === -1 ? FIELD_ORDER.length : at;
  };
  return [...new Set([...(change.fields ?? []), ...Object.keys(after)])]
    .sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1))
    .map((field) => ({
      field,
      before: before[field] ?? null,
      after: after[field] ?? null,
      shown: showsField(change, field) && Object.hasOwn(after, field),
    }));
};

/** Whether the log shows a change's before and after: an update of one short field (else only that it changed). */
export const showsValues = (change: PublicStructuralChange): boolean =>
  change.action === 'update' && change.field !== null && showsField(change, change.field);
