'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

import { FormMessages } from '@/ui/FormMessages';
import { formText, localizedFromForm } from '@/ui/forms';
import { type LocaleOption, LocalizedField } from '@/ui/LocalizedField';
import * as styles from '@/ui/styles';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

export type ElectionType = 'general' | 'european' | 'regional' | 'municipal' | 'other';
const TYPES: readonly ElectionType[] = ['general', 'european', 'regional', 'municipal', 'other'];
/** Whether a type covers one subdivision: regional ones always, municipal and other ones may (E1.2). */
const TERRITORY: Record<ElectionType, 'none' | 'required' | 'optional'> = {
  general: 'none',
  european: 'none',
  regional: 'required',
  municipal: 'optional',
  other: 'optional',
};

export interface ElectionFormText {
  name: string;
  nameHint: string;
  needed: string;
  slug: string;
  slugHint: string;
  type: string;
  types: Record<ElectionType, string>;
  territory: string;
  territoryHint: string;
  territoryNone: string;
  date: string;
  dateHint: string;
  save: string;
  saved: string;
  errors: Record<WriteError, string>;
  /** Field-specific refusals, by the constraint that refused them. */
  constraints: Record<string, string>;
}

export interface ElectionValues {
  slug: string;
  type: ElectionType;
  territoryCode: string | null;
  name: Readonly<Record<string, string>>;
  date: string | null;
}

const ERROR_ID = 'election-error';

/**
 * An election's fields (editorial workflow E1.2): its name per language, slug, type, territory and date. A new one is
 * created as a draft; an existing draft is changed in place. The territory is the subdivision part of an ISO 3166-2
 * code, after the tenant's country, which the database checks again (`election_rules`), as it does everything here.
 */
export const ElectionForm = ({
  tenant,
  countryCode,
  locales,
  election,
  text,
}: {
  tenant: string;
  countryCode: string;
  locales: LocaleOption[];
  /** The election being changed; none when creating one. */
  election?: ElectionValues;
  text: ElectionFormText;
}) => {
  const router = useRouter();
  const { pending, error, status, statusLine, run } = useWrite();
  const [constraint, setConstraint] = useState<string>();
  const [type, setType] = useState<ElectionType>(election?.type ?? 'general');
  const territory = TERRITORY[type];
  const prefix = `${countryCode}-`;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const suffix = formText(form, 'territory').trim().toUpperCase();
    const body = {
      name: localizedFromForm(form, 'name', locales),
      slug: formText(form, 'slug').trim(),
      type,
      territoryCode: territory === 'none' || suffix === '' ? null : `${prefix}${suffix}`,
      date: formText(form, 'date') || null,
    };
    setConstraint(undefined);
    const answer = await run(
      () =>
        election
          ? sendToApi(
              'PATCH',
              `/api/t/${encodeURIComponent(tenant)}/e/${encodeURIComponent(election.slug)}`,
              body,
            )
          : sendToApi('POST', `/api/t/${encodeURIComponent(tenant)}/elections`, body),
      text.saved,
    );
    if (answer && !answer.ok) {
      setConstraint(answer.constraint);
      return;
    }
    if (answer?.ok && body.slug !== election?.slug) {
      router.replace(`/t/${tenant}/e/${body.slug}`);
    }
  };

  const fieldError = (...constraints: string[]) =>
    constraint !== undefined && constraints.includes(constraint) ? ERROR_ID : undefined;
  return (
    <form className={styles.form} onSubmit={submit}>
      <LocalizedField
        name="name"
        label={text.name}
        hint={text.nameHint}
        locales={locales}
        values={election?.name}
        maxLength={200}
        requiredLabel={text.needed}
        describedBy={
          fieldError('localized_check') ??
          (error === 'incomplete' && constraint === undefined ? ERROR_ID : undefined)
        }
      />
      <div className={styles.field}>
        <label className={styles.label} htmlFor="election-slug">
          {text.slug}
        </label>
        <p id="election-slug-hint" className={styles.hint}>
          {text.slugHint}
        </p>
        <input
          id="election-slug"
          className={styles.input}
          name="slug"
          required
          maxLength={63}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          autoCapitalize="none"
          spellCheck={false}
          defaultValue={election?.slug}
          aria-invalid={
            fieldError(
              'slug_check',
              'slug_length',
              'elections_slug_check',
              'elections_slug_not_reserved',
              'elections_tenant_id_slug_key',
            )
              ? true
              : undefined
          }
          aria-describedby={[
            'election-slug-hint',
            fieldError(
              'slug_check',
              'slug_length',
              'elections_slug_check',
              'elections_slug_not_reserved',
              'elections_tenant_id_slug_key',
            ),
          ]
            .filter(Boolean)
            .join(' ')}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="election-type">
          {text.type}
        </label>
        <select
          id="election-type"
          className={styles.select}
          name="type"
          value={type}
          onChange={(event) => setType(event.target.value as ElectionType)}
        >
          {TYPES.map((value) => (
            <option key={value} value={value}>
              {text.types[value]}
            </option>
          ))}
        </select>
      </div>
      {territory === 'none' ? (
        <p className={styles.hint}>{text.territoryNone}</p>
      ) : (
        <div className={styles.field}>
          <label className={styles.label} htmlFor="election-territory">
            {text.territory}
          </label>
          <p id="election-territory-hint" className={styles.hint}>
            {text.territoryHint.replace('{prefix}', prefix)}
          </p>
          <span className={styles.prefixed}>
            <span aria-hidden="true">{prefix}</span>
            <input
              id="election-territory"
              className={styles.input}
              name="territory"
              required={territory === 'required'}
              maxLength={3}
              pattern="[A-Za-z0-9]{1,3}"
              autoCapitalize="characters"
              spellCheck={false}
              defaultValue={election?.territoryCode?.slice(prefix.length) ?? ''}
              aria-invalid={
                fieldError('elections_check1', 'elections_territory_code_check') ? true : undefined
              }
              aria-describedby={[
                'election-territory-hint',
                fieldError('elections_check1', 'elections_territory_code_check'),
              ]
                .filter(Boolean)
                .join(' ')}
            />
          </span>
        </div>
      )}
      <div className={styles.field}>
        <label className={styles.label} htmlFor="election-date">
          {text.date}
        </label>
        <p id="election-date-hint" className={styles.hint}>
          {text.dateHint}
        </p>
        <input
          id="election-date"
          className={styles.input}
          name="date"
          type="date"
          defaultValue={election?.date ?? ''}
          aria-describedby="election-date-hint"
        />
      </div>
      <FormMessages
        id={ERROR_ID}
        statusRef={statusLine}
        error={error}
        status={error && constraint && text.constraints[constraint] ? '' : status}
        errors={
          error && constraint && text.constraints[constraint]
            ? { ...text.errors, [error]: text.constraints[constraint] }
            : text.errors
        }
      />
      <div>
        <button className={styles.button} type="submit" aria-disabled={pending}>
          {text.save}
        </button>
      </div>
    </form>
  );
};
