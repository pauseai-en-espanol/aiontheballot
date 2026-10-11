'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

import { FormMessages } from '@/ui/FormMessages';
import { formText, localizedFromForm } from '@/ui/forms';
import { type LocaleOption, LocalizedField } from '@/ui/LocalizedField';
import * as styles from '@/ui/styles';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

export interface PartyFormText {
  name: string;
  shortName: string;
  shortNameHint: string;
  needed: string;
  slug: string;
  slugHint: string;
  colour: string;
  colourHint: string;
  noColour: string;
  website: string;
  territories: string;
  territoriesHint: string;
  save: string;
  saved: string;
  errors: Record<WriteError, string>;
  constraints: Record<string, string>;
}

const ERROR_ID = 'party-error';

/**
 * A party of a draft election (editorial workflow E4.1): its name and short name per language, slug, colour, website and
 * the territories it stands in, if not everywhere (inside the tenant's country, which the database checks). A party's
 * colour is never used to show a rating. Logos wait for uploads.
 */
export const PartyForm = ({
  path,
  method,
  then,
  values,
  countryCode,
  locales,
  text,
}: {
  path: string;
  method: 'POST' | 'PUT';
  /** Where to go once saved. */
  then: string;
  values?: {
    slug: string;
    name: Readonly<Record<string, string>>;
    shortName: Readonly<Record<string, string>>;
    colour: string | null;
    website: string | null;
    territoryCodes: string[] | null;
  };
  countryCode: string;
  locales: LocaleOption[];
  text: PartyFormText;
}) => {
  const router = useRouter();
  const { pending, error, status, statusLine, run } = useWrite();
  const [constraint, setConstraint] = useState<string>();
  const [hasColour, setHasColour] = useState(
    values?.colour !== null && values?.colour !== undefined,
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const territories = formText(form, 'territories')
      .split(/[\s,]+/)
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean);
    setConstraint(undefined);
    const answer = await run(
      () =>
        sendToApi(method, path, {
          slug: formText(form, 'slug').trim(),
          name: localizedFromForm(form, 'name', locales),
          shortName: localizedFromForm(form, 'shortName', locales),
          colour: hasColour ? formText(form, 'colour').toLowerCase() : null,
          website: formText(form, 'website').trim() || null,
          territoryCodes: territories.length > 0 ? territories : null,
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
        name="name"
        label={text.name}
        locales={locales}
        values={values?.name}
        maxLength={200}
        requiredLabel={text.needed}
        describedBy={error ? ERROR_ID : undefined}
      />
      <LocalizedField
        name="shortName"
        label={text.shortName}
        hint={text.shortNameHint}
        locales={locales}
        values={values?.shortName}
        maxLength={60}
        requiredLabel={text.needed}
        describedBy={error ? ERROR_ID : undefined}
      />
      <div className={styles.field}>
        <label className={styles.label} htmlFor="party-slug">
          {text.slug}
        </label>
        <p id="party-slug-hint" className={styles.hint}>
          {text.slugHint}
        </p>
        <input
          id="party-slug"
          className={styles.input}
          name="slug"
          required
          maxLength={63}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          autoCapitalize="none"
          spellCheck={false}
          defaultValue={values?.slug}
          aria-describedby={['party-slug-hint', constraint?.includes('slug') ? ERROR_ID : '']
            .join(' ')
            .trim()}
        />
      </div>
      <fieldset className={styles.fieldset}>
        <legend className={styles.label}>{text.colour}</legend>
        <p id="party-colour-hint" className={styles.hint}>
          {text.colourHint}
        </p>
        <div className={styles.checkboxField}>
          <input
            id="party-no-colour"
            className={styles.checkbox}
            type="checkbox"
            checked={!hasColour}
            onChange={(event) => setHasColour(!event.target.checked)}
          />
          <label htmlFor="party-no-colour">{text.noColour}</label>
        </div>
        {hasColour ? (
          <input
            className={styles.colourInput}
            name="colour"
            type="color"
            aria-label={text.colour}
            aria-describedby="party-colour-hint"
            defaultValue={values?.colour ?? '#808080'}
          />
        ) : null}
      </fieldset>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="party-website">
          {text.website}
        </label>
        <input
          id="party-website"
          className={styles.input}
          name="website"
          type="url"
          maxLength={500}
          placeholder="https://"
          defaultValue={values?.website ?? ''}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="party-territories">
          {text.territories}
        </label>
        <p id="party-territories-hint" className={styles.hint}>
          {text.territoriesHint.replace('{country}', countryCode)}
        </p>
        <input
          id="party-territories"
          className={styles.input}
          name="territories"
          maxLength={600}
          autoCapitalize="characters"
          spellCheck={false}
          defaultValue={values?.territoryCodes?.join(', ') ?? ''}
          aria-describedby="party-territories-hint"
        />
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
