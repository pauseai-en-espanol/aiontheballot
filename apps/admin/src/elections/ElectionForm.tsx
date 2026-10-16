'use client';

import { useRouter } from 'next/navigation';
import { type ComponentProps, type FormEvent, useState } from 'react';

import { announce } from '@/ui/announce';
import {
  checkValues,
  constraintProblems,
  type Problems,
  type ProblemText,
  refusalProblem,
} from '@/ui/checks';
import { Field, FieldInput, FieldSelect } from '@/ui/Field';
import { FormActions } from '@/ui/FormActions';
import { FormMessages } from '@/ui/FormMessages';
import { formText, localizedFromForm } from '@/ui/forms';
import { type LocaleOption, LocalizedField } from '@/ui/LocalizedField';
import { SlugField } from '@/ui/SlugField';
import * as styles from '@/ui/styles';
import { type Territory } from '@/ui/territory-tree';
import { type TerritoryPickerText, TerritorySelect } from '@/ui/TerritoryPicker';
import { useProblems } from '@/ui/useProblems';
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
  optional: string;
  slug: ComponentProps<typeof SlugField>['text'];
  type: string;
  types: Record<ElectionType, string>;
  territory: string;
  territoryHint: string;
  /** The select's hint, where the site's country has subdivisions to choose from (PLAN R201). */
  territoryPickHint: string;
  territoryPicker: Pick<TerritoryPickerText, 'whole' | 'choose'>;
  territoryNone: string;
  date: string;
  dateHint: string;
  save: string;
  saved: string;
  /** Said on the new election's page, once it is created. */
  created: string;
  errors: Record<WriteError, string>;
  problems: ProblemText;
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

type ElectionField = 'name' | 'slug' | 'type' | 'territory' | 'date';

const ERROR_ID = 'election-error';

/** The field each constraint the database names is about. */
const CONSTRAINT_FIELDS: Readonly<Record<string, ElectionField>> = {
  localized_check: 'name',
  slug_check: 'slug',
  slug_length: 'slug',
  elections_slug_check: 'slug',
  elections_slug_not_reserved: 'slug',
  elections_tenant_id_slug_key: 'slug',
  elections_check1: 'territory',
  elections_check: 'territory',
  elections_territory_code_check: 'territory',
};

/** The request's fields, as the form names them. */
const BODY_FIELDS: Readonly<Record<string, ElectionField>> = {
  name: 'name',
  slug: 'slug',
  type: 'type',
  territoryCode: 'territory',
  date: 'date',
};

/**
 * An election's fields (editorial workflow E1.2): its name per language, slug, type, territory and date. A new one is
 * created as a draft; an existing draft is changed in place. The territory is the subdivision part of an ISO 3166-2
 * code, after the tenant's country, which the database checks again (`election_rules`), as it does everything here.
 * What is wrong shows at its field, in words, and the first takes focus (admin forms §1.2). Its slug follows the name
 * until edited and shows the public address it makes (§1.5). A change stays on the page and says "Saved." beside the
 * button; a new election opens its own page, which says it was created (§1.4).
 */
export const ElectionForm = ({
  tenant,
  countryCode,
  territories,
  locales,
  locale,
  election,
  slugAddress,
  text,
}: {
  tenant: string;
  countryCode: string;
  /** The country's subdivisions to choose from; none keeps the code field (PLAN R201). */
  territories: readonly Territory[];
  locales: LocaleOption[];
  /** The page's language, which the subdivisions are sorted in. */
  locale: string;
  /** The election being changed; none when creating one. */
  election?: ElectionValues;
  /** Its public path, with `{slug}` where the slug goes. */
  slugAddress: string;
  text: ElectionFormText;
}) => {
  const router = useRouter();
  const { pending, error, status, statusLine, run, setError } = useWrite();
  const { problems, show, form: formRef } = useProblems<ElectionField>();
  const [type, setType] = useState<ElectionType>(election?.type ?? 'general');
  const territory = TERRITORY[type];
  const prefix = `${countryCode}-`;

  const check = (form: HTMLFormElement): Problems<ElectionField> => {
    const found: Problems<ElectionField> = checkValues(
      { slug: formText(form, 'slug').trim() },
      { slug: { required: true, shape: 'slug' } },
      text.problems,
    );
    if (
      Object.values(localizedFromForm(form, 'name', locales)).every((value) => value.trim() === '')
    ) {
      found.name = text.problems.localized;
    }
    const suffix = formText(form, 'territory').trim();
    if (territory === 'required' && suffix === '') {
      found.territory = text.constraints.elections_check1 ?? text.problems.required;
    } else if (territory !== 'none' && suffix !== '' && !/^[A-Za-z0-9]{1,3}$/u.test(suffix)) {
      found.territory = text.constraints.elections_territory_code_check ?? text.problems.invalid;
    }
    return found;
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (show(check(form))) {
      setError(undefined);
      return;
    }
    const suffix = formText(form, 'territory').trim().toUpperCase();
    const body = {
      name: localizedFromForm(form, 'name', locales),
      slug: formText(form, 'slug').trim(),
      type,
      territoryCode: territory === 'none' || suffix === '' ? null : `${prefix}${suffix}`,
      date: formText(form, 'date') || null,
    };
    const answer = await run(
      () =>
        election
          ? sendToApi(
              'PATCH',
              `/api/t/${encodeURIComponent(tenant)}/e/${encodeURIComponent(election.slug)}`,
              body,
            )
          : sendToApi('POST', `/api/t/${encodeURIComponent(tenant)}/elections`, body),
      election ? text.saved : () => undefined,
    );
    if (answer && !answer.ok) {
      const pointed = refusalProblem(
        answer,
        constraintProblems(CONSTRAINT_FIELDS, text.constraints, text.problems.invalid),
        Object.fromEntries(
          Object.entries(BODY_FIELDS).map(([name, field]) => [
            name,
            [field, text.problems.invalid],
          ]),
        ),
      );
      if (pointed && show(pointed)) {
        setError(undefined);
      }
      return;
    }
    if (answer?.ok && !election) {
      announce(text.created, { afterNavigation: true });
      router.replace(`/t/${tenant}/e/${body.slug}`);
    } else if (answer?.ok && body.slug !== election?.slug) {
      // Its address in the admin follows the new slug.
      announce(text.saved, { afterNavigation: true });
      router.replace(`/t/${tenant}/e/${body.slug}`);
    }
  };

  return (
    <form ref={formRef} className={styles.form} onSubmit={submit} noValidate>
      <LocalizedField
        name="name"
        label={text.name}
        hint={text.nameHint}
        locales={locales}
        values={election?.name}
        maxLength={200}
        requiredLabel={text.needed}
        error={problems.name}
      />
      <SlugField
        from={election ? undefined : `name.${locales[0]?.code ?? ''}`}
        value={election?.slug}
        address={slugAddress}
        error={problems.slug}
        text={text.slug}
      />
      <Field label={text.type} error={problems.type}>
        <FieldSelect
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
        </FieldSelect>
      </Field>
      {territory === 'none' ? (
        <p className={styles.hint}>{text.territoryNone}</p>
      ) : (
        <Field
          label={text.territory}
          hint={
            territories.length > 0
              ? text.territoryPickHint
              : text.territoryHint.replace('{prefix}', prefix)
          }
          optional={territory === 'optional' ? text.optional : undefined}
          error={problems.territory}
          required={territory === 'required'}
        >
          {territories.length > 0 ? (
            <TerritorySelect
              name="territory"
              territories={territories}
              prefix={prefix}
              initial={election?.territoryCode ?? null}
              required={territory === 'required'}
              locale={locale}
              text={text.territoryPicker}
            />
          ) : (
            <span className={styles.prefixed}>
              <span aria-hidden="true">{prefix}</span>
              <FieldInput
                className={styles.input}
                name="territory"
                maxLength={3}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                defaultValue={election?.territoryCode?.slice(prefix.length) ?? ''}
              />
            </span>
          )}
        </Field>
      )}
      <Field label={text.date} hint={text.dateHint} optional={text.optional} error={problems.date}>
        <FieldInput
          className={styles.input}
          name="date"
          type="date"
          defaultValue={election?.date ?? ''}
        />
      </Field>
      <FormMessages id={ERROR_ID} error={error} errors={text.errors} />
      <FormActions label={text.save} pending={pending} status={status} statusRef={statusLine} />
    </form>
  );
};
