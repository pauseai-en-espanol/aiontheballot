'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

import { FormMessages } from '@/ui/FormMessages';
import { formText, localizedFromForm } from '@/ui/forms';
import { type LocaleOption, LocalizedField } from '@/ui/LocalizedField';
import * as styles from '@/ui/styles';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

export interface CriterionFormText {
  title: string;
  shortTitle: string;
  shortTitleHint: string;
  description: string;
  needed: string;
  slug: string;
  slugHint: string;
  core: string;
  coreHint: string;
  noCore: string;
  save: string;
  saved: string;
  errors: Record<WriteError, string>;
  constraints: Record<string, string>;
}

const ERROR_ID = 'criterion-error';

/**
 * A criterion of a draft election (editorial workflow E4.4): its title, short title and description per language, its
 * slug, and optionally the core criterion it matches. The short title heads the criterion's column in the public table,
 * so its field is no wider than that column (W22); going live needs it in the default language.
 */
export const CriterionForm = ({
  path,
  method,
  then,
  values,
  coreCriteria,
  locales,
  text,
}: {
  path: string;
  method: 'POST' | 'PUT';
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
  text: CriterionFormText;
}) => {
  const router = useRouter();
  const { pending, error, status, statusLine, run } = useWrite();
  const [constraint, setConstraint] = useState<string>();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setConstraint(undefined);
    const answer = await run(
      () =>
        sendToApi(method, path, {
          slug: formText(form, 'slug').trim(),
          title: localizedFromForm(form, 'title', locales),
          shortTitle: localizedFromForm(form, 'shortTitle', locales),
          description: localizedFromForm(form, 'description', locales),
          coreCriterionId: formText(form, 'core') || null,
        }),
      text.saved,
    );
    if (answer && !answer.ok) {
      setConstraint(answer.constraint);
      return;
    }
    if (answer?.ok) {
      router.push(then);
    }
  };

  const constraintMessage = constraint ? text.constraints[constraint] : undefined;
  const errors =
    error && constraintMessage ? { ...text.errors, [error]: constraintMessage } : text.errors;
  return (
    <form className={styles.form} onSubmit={submit}>
      <LocalizedField
        name="title"
        label={text.title}
        locales={locales}
        values={values?.title}
        maxLength={300}
        requiredLabel={text.needed}
        describedBy={error ? ERROR_ID : undefined}
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
        describedBy={error ? ERROR_ID : undefined}
      />
      <div className={styles.field}>
        <label className={styles.label} htmlFor="criterion-slug">
          {text.slug}
        </label>
        <p id="criterion-slug-hint" className={styles.hint}>
          {text.slugHint}
        </p>
        <input
          id="criterion-slug"
          className={styles.input}
          name="slug"
          required
          maxLength={63}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          autoCapitalize="none"
          spellCheck={false}
          defaultValue={values?.slug}
          aria-describedby={['criterion-slug-hint', constraint?.includes('slug') ? ERROR_ID : '']
            .join(' ')
            .trim()}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="criterion-core">
          {text.core}
        </label>
        <p id="criterion-core-hint" className={styles.hint}>
          {text.coreHint}
        </p>
        <select
          id="criterion-core"
          className={styles.select}
          name="core"
          defaultValue={values?.coreCriterionId ?? ''}
          aria-describedby="criterion-core-hint"
        >
          <option value="">{text.noCore}</option>
          {coreCriteria.map((core) => (
            <option key={core.id} value={core.id} lang={core.lang}>
              {core.title}
            </option>
          ))}
        </select>
      </div>
      <FormMessages
        id={ERROR_ID}
        error={error}
        status={status}
        statusRef={statusLine}
        errors={errors}
      />
      <div>
        <button className={styles.button} type="submit" aria-disabled={pending}>
          {text.save}
        </button>
      </div>
    </form>
  );
};
