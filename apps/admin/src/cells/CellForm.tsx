'use client';

import { type FormEvent, useState } from 'react';

import { FormMessages } from '@/ui/FormMessages';
import { formText, localizedFromForm } from '@/ui/forms';
import { type LocaleOption, LocalizedField } from '@/ui/LocalizedField';
import * as styles from '@/ui/styles';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

import type { ChangeKind, Rating } from './data';

import { StaleNotice } from './StaleNotice';

export interface CellFormText {
  rating: string;
  noRating: string;
  ratings: Record<string, string>;
  summary: string;
  summaryHint: string;
  changeKind: string;
  changeKindHint: string;
  changeKinds: Record<Exclude<ChangeKind, 'initial'>, string>;
  publicNote: string;
  publicNoteHint: string;
  needed: string;
  save: string;
  saved: string;
  stale: string;
  reload: string;
  errors: Record<WriteError, string>;
}

const ERROR_ID = 'cell-error';

/**
 * A draft's rating, summary and, after the first publish, its kind of change and public note (editorial workflow C2,
 * C10, C11), saved all at once at the version loaded (C14). The scale is the methodology's; the database checks it,
 * and everything a submission needs, again.
 */
export const CellForm = ({
  path,
  version,
  scale,
  values,
  locales,
  afterFirstPublish,
  text,
}: {
  /** The cell's route in the API. */
  path: string;
  version: number;
  scale: readonly Rating[];
  values: {
    rating: Rating | null;
    summary: Record<string, string> | null;
    changeKind: ChangeKind | null;
    publicNote: Record<string, string> | null;
  };
  /** The site's languages, its main one first and needed to submit. */
  locales: LocaleOption[];
  /** Whether it was published before, so a change needs a kind and a public note. */
  afterFirstPublish: boolean;
  text: CellFormText;
}) => {
  const { pending, error, status, statusLine, run } = useWrite();
  const [stale, setStale] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const rating = formText(form, 'rating');
    const changeKind = formText(form, 'changeKind');
    const body = {
      version,
      rating: rating === '' ? null : rating,
      summary: localizedFromForm(form, 'summary', locales),
      changeKind: afterFirstPublish && changeKind !== '' ? changeKind : null,
      publicNote: afterFirstPublish ? localizedFromForm(form, 'publicNote', locales) : null,
    };
    setStale(false);
    const answer = await run(() => sendToApi('PUT', path, body), text.saved);
    if (answer?.error === 'stale') {
      setStale(true);
    }
  };

  return (
    <form className={styles.form} onSubmit={submit}>
      <fieldset className={styles.fieldset}>
        <legend className={styles.label}>{text.rating}</legend>
        {[...scale, null].map((rating) => {
          const id = `cell-rating-${rating ?? 'none'}`;
          return (
            <div key={id} className={styles.checkboxField}>
              <input
                id={id}
                className={styles.checkbox}
                type="radio"
                name="rating"
                value={rating ?? ''}
                defaultChecked={values.rating === rating}
              />
              <label className={styles.label} htmlFor={id}>
                {rating === null ? text.noRating : (text.ratings[rating] ?? rating)}
              </label>
            </div>
          );
        })}
      </fieldset>
      <LocalizedField
        name="summary"
        label={text.summary}
        hint={text.summaryHint}
        locales={locales}
        values={values.summary ?? {}}
        multiline
        maxLength={4000}
        requiredLabel={text.needed}
        describedBy={error ? ERROR_ID : undefined}
      />
      {afterFirstPublish ? (
        <>
          <fieldset className={styles.fieldset} aria-describedby="cell-change-kind-hint">
            <legend className={styles.label}>{text.changeKind}</legend>
            <p id="cell-change-kind-hint" className={styles.hint}>
              {text.changeKindHint}
            </p>
            {(['update', 'correction', 'withdrawal'] as const).map((kind) => (
              <div key={kind} className={styles.checkboxField}>
                <input
                  id={`cell-change-${kind}`}
                  className={styles.checkbox}
                  type="radio"
                  name="changeKind"
                  value={kind}
                  defaultChecked={values.changeKind === kind}
                />
                <label className={styles.label} htmlFor={`cell-change-${kind}`}>
                  {text.changeKinds[kind]}
                </label>
              </div>
            ))}
          </fieldset>
          <LocalizedField
            name="publicNote"
            label={text.publicNote}
            hint={text.publicNoteHint}
            locales={locales}
            values={values.publicNote ?? {}}
            multiline
            maxLength={2000}
            requiredLabel={text.needed}
          />
        </>
      ) : null}
      <FormMessages
        id={ERROR_ID}
        statusRef={statusLine}
        error={stale ? undefined : error}
        status={status}
        errors={text.errors}
      />
      {stale ? <StaleNotice text={{ stale: text.stale, reload: text.reload }} /> : null}
      <div>
        <button className={styles.button} type="submit" aria-disabled={pending}>
          {text.save}
        </button>
      </div>
    </form>
  );
};
