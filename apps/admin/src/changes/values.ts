import type { FieldKind } from './fields';

/**
 * A change request's values as the forms compare them (PLAN R183): normalized as the API and the database keep them,
 * so a field counts as changed only when what it will store differs from what is there. Pure, for the forms and their
 * unit tests.
 */

/** A localized text with its empty languages left out and its languages in one order. */
const localizedValue = (value: unknown): Record<string, string> | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([locale, text]) => [locale, text.trim()] as const)
    .filter(([, text]) => text !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.length > 0 ? Object.fromEntries(entries) : null;
};

/** A value of a field as it will be stored: localized text, codes and lists normalized, blanks as none. */
export const normalized = (kind: FieldKind, value: unknown): unknown => {
  switch (kind) {
    case 'localized':
    case 'localizedLong':
      return localizedValue(value);
    case 'colour':
      return typeof value === 'string' && value.trim() !== '' ? value.trim().toLowerCase() : null;
    case 'codes': {
      const codes = Array.isArray(value)
        ? value.filter((code): code is string => typeof code === 'string')
        : typeof value === 'string'
          ? value.split(/[\s,]+/u)
          : [];
      const kept = [...new Set(codes.map((code) => code.trim().toUpperCase()).filter(Boolean))];
      return kept.length > 0 ? kept : null;
    }
    case 'sourceKinds':
      return Array.isArray(value) ? [...value].map(String).sort() : [];
    case 'number':
      return typeof value === 'number'
        ? value
        : value === '' || value === null
          ? null
          : Number(value);
    case 'url':
    case 'date':
      return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
    case 'logo':
      return typeof value === 'string' ? value : null;
    default:
      return typeof value === 'string' ? value.trim() : value;
  }
};

/** Whether a field's new value is what it is now, once both are normalized. */
export const sameValue = (kind: FieldKind, now: unknown, next: unknown): boolean =>
  JSON.stringify(normalized(kind, now)) === JSON.stringify(normalized(kind, next));

/** The fields whose new value differs from now, in the form's order, with the value to send. */
export const changedValues = (
  fields: Readonly<Record<string, FieldKind>>,
  now: Readonly<Record<string, unknown>>,
  next: Readonly<Record<string, unknown>>,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(fields)
      .filter(([name]) => Object.hasOwn(next, name))
      .filter(([name, kind]) => !sameValue(kind, now[name], next[name]))
      .map(([name, kind]) => [
        name,
        kind === 'localized' || kind === 'localizedLong'
          ? (normalized(kind, next[name]) ?? {})
          : normalized(kind, next[name]),
      ]),
  );

/** The order the forms list a target's fields in, which a set's fields (an object, in no order) are shown in. */
const FIELD_ORDER = [
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
  'body',
  'admissible_source_kinds',
  'not_mentioned_source_kinds',
  'affiliation',
  'demands_owner_id',
  'core_criterion_id',
  'display_order',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The fields an update changes, each with its value before and its new one: its one field, or each of a set's (PLAN
 * R183), in the forms' order.
 */
export const fieldChanges = (
  field: string | null,
  previous: unknown,
  next: unknown,
): { field: string; before: unknown; after: unknown }[] => {
  if (field !== null) {
    return [{ field, before: previous, after: next }];
  }
  if (!isRecord(next)) {
    return [];
  }
  const rank = (name: string) => {
    const at = FIELD_ORDER.indexOf(name);
    return at === -1 ? FIELD_ORDER.length : at;
  };
  return Object.keys(next)
    .sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1))
    .map((name) => ({
      field: name,
      before: isRecord(previous) ? (previous[name] ?? null) : null,
      after: next[name],
    }));
};
