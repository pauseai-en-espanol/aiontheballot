'use client';

import type { ComponentProps, FormEvent } from 'react';

import { useRouter } from 'next/navigation';

import { announce } from '@/ui/announce';
import {
  checkValues,
  constraintProblems,
  type Problems,
  type ProblemText,
  refusalProblem,
} from '@/ui/checks';
import { Field, FieldSelect } from '@/ui/Field';
import { FormActions } from '@/ui/FormActions';
import { FormMessages } from '@/ui/FormMessages';
import { formText, localizedFromForm } from '@/ui/forms';
import { type LocaleOption, LocalizedField } from '@/ui/LocalizedField';
import { SlugField } from '@/ui/SlugField';
import * as styles from '@/ui/styles';
import { useProblems } from '@/ui/useProblems';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

export interface CriterionFormText {
  title: string;
  shortTitle: string;
  shortTitleHint: string;
  description: string;
  needed: string;
  slug: ComponentProps<typeof SlugField>['text'];
  core: string;
  coreHint: string;
  noCore: string;
  save: string;
  saved: string;
  /** Said on the list, once a new one is added. */
  added: string;
  optional: string;
  errors: Record<WriteError, string>;
  problems: ProblemText;
  constraints: Record<string, string>;
}

type CriterionField = 'title' | 'shortTitle' | 'description' | 'slug' | 'core';

const ERROR_ID = 'criterion-error';

/** The field each constraint the database names is about (a missing text: the first that needs one). */
const CONSTRAINT_FIELDS: Readonly<Record<string, CriterionField>> = {
  localized_check: 'title',
  slug_check: 'slug',
  slug_length: 'slug',
  criteria_election_id_slug_key: 'slug',
};

/** The request's fields, as the form names them. */
const BODY_FIELDS: Readonly<Record<string, CriterionField>> = {
  title: 'title',
  shortTitle: 'shortTitle',
  description: 'description',
  slug: 'slug',
  coreCriterionId: 'core',
};

/**
 * A criterion of a draft election (editorial workflow E4.4): its title, short title and description per language, its
 * slug, and optionally the core criterion it matches. The short title heads the criterion's column in the public table,
 * so its field is no wider than that column (W22); going live needs it in the default language. Its slug follows the
 * title until edited and shows the public address it makes (admin forms §1.5). A change stays on the page and says
 * "Saved." beside the button; a new one goes back to the list, which says it was added (§1.4).
 */
export const CriterionForm = ({
  path,
  method,
  then,
  values,
  coreCriteria,
  locales,
  slugAddress,
  text,
}: {
  path: string;
  method: 'POST' | 'PUT';
  /** The election's criteria in the admin, where a new one goes back to. */
  then: string;
  values?: {
    slug: string;
    title: Readonly<Record<string, string>>;
    shortTitle: Readonly<Record<string, string>> | null;
    description: Readonly<Record<string, string>>;
    coreCriterionId: string | null;
  };
  coreCriteria: { id: string; title: string; lang: string }[];
  locales: LocaleOption[];
  /** Its public path, with `{slug}` where the slug goes. */
  slugAddress: string;
  text: CriterionFormText;
}) => {
  const router = useRouter();
  const { pending, error, status, statusLine, run, setError } = useWrite();
  const { problems, show, form: formRef } = useProblems<CriterionField>();

  /** What the form can tell before sending (admin forms §1.2). */
  const check = (form: HTMLFormElement): Problems<CriterionField> => {
    const found: Problems<CriterionField> = checkValues(
      { slug: formText(form, 'slug').trim() },
      { slug: { required: true, shape: 'slug' } },
      text.problems,
    );
    for (const name of ['title', 'description'] as const) {
      if (
        Object.values(localizedFromForm(form, name, locales)).every((value) => value.trim() === '')
      ) {
        found[name] = text.problems.localized;
      }
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
    const answer = await run(
      () =>
        sendToApi(method, path, {
          slug: formText(form, 'slug').trim(),
          title: localizedFromForm(form, 'title', locales),
          shortTitle: localizedFromForm(form, 'shortTitle', locales),
          description: localizedFromForm(form, 'description', locales),
          coreCriterionId: formText(form, 'core') || null,
        }),
      method === 'PUT' ? text.saved : () => undefined,
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
    if (answer?.ok && method === 'POST') {
      announce(text.added, { afterNavigation: true });
      router.push(then);
    }
  };

  return (
    <form ref={formRef} className={styles.form} onSubmit={submit} noValidate>
      <LocalizedField
        name="title"
        label={text.title}
        locales={locales}
        values={values?.title}
        maxLength={300}
        requiredLabel={text.needed}
        error={problems.title}
      />
      <div className={styles.shortTitle}>
        <LocalizedField
          name="shortTitle"
          label={text.shortTitle}
          hint={text.shortTitleHint}
          locales={locales}
          values={values?.shortTitle ?? undefined}
          maxLength={40}
          requiredLabel={text.needed}
          error={problems.shortTitle}
        />
      </div>
      <LocalizedField
        name="description"
        label={text.description}
        locales={locales}
        values={values?.description}
        multiline
        maxLength={5_000}
        requiredLabel={text.needed}
        error={problems.description}
      />
      <SlugField
        from={values ? undefined : `title.${locales[0]?.code ?? ''}`}
        value={values?.slug}
        address={slugAddress}
        error={problems.slug}
        text={text.slug}
      />
      <Field label={text.core} hint={text.coreHint} optional={text.optional} error={problems.core}>
        <FieldSelect
          className={styles.select}
          name="core"
          defaultValue={values?.coreCriterionId ?? ''}
        >
          <option value="">{text.noCore}</option>
          {coreCriteria.map((core) => (
            <option key={core.id} value={core.id} lang={core.lang}>
              {core.title}
            </option>
          ))}
        </FieldSelect>
      </Field>
      <FormMessages id={ERROR_ID} error={error} errors={text.errors} />
      <FormActions label={text.save} pending={pending} status={status} statusRef={statusLine} />
    </form>
  );
};
