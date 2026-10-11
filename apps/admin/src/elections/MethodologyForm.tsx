'use client';

import { type FormEvent, useState } from 'react';

import type { SourceKind } from '@/elections/data';

import { FormMessages } from '@/ui/FormMessages';
import { localizedFromForm } from '@/ui/forms';
import { type LocaleOption, LocalizedField } from '@/ui/LocalizedField';
import * as styles from '@/ui/styles';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

export interface MethodologyFormText {
  owner: string;
  ownerHint: string;
  body: string;
  bodyHint: string;
  needed: string;
  admissible: string;
  admissibleHint: string;
  notMentioned: string;
  notMentionedHint: string;
  kinds: Record<SourceKind, string>;
  /** Per kind in use: how many quotes and checked documents use it, in words (plurals built on the server). */
  usage: Partial<Record<SourceKind, string>>;
  /** Per kind quotes use: the warning when it is unticked from the first list. */
  removedQuotes: Partial<Record<SourceKind, string>>;
  /** Per kind checked documents use: the warning when it is unticked from the second. */
  removedChecked: Partial<Record<SourceKind, string>>;
  /** When a list is left empty (`methodologies_check1`). */
  kindsNeeded: string;
  save: string;
  saved: string;
  errors: Record<WriteError, string>;
}

const KINDS: readonly SourceKind[] = [
  'pdf',
  'web_page',
  'social_post',
  'video',
  'audio',
  'party_submission',
];
const ERROR_ID = 'methodology-error';

/**
 * An election's one methodology (editorial workflow E2): its kind is the tenant's and is shown, not chosen; a demands
 * methodology names whose demands it uses (the operator or an endorser); its text is Markdown per language; and it
 * lists the kinds of source that may back a rating and those that may back "not mentioned". Unticking a kind that quotes
 * or checked documents already use says how many, since those cells can't be submitted or published until fixed (E2.5).
 */
export const MethodologyForm = ({
  path,
  demands,
  owners,
  values,
  usage,
  locales,
  text,
}: {
  path: string;
  demands: boolean;
  owners: { id: string; name: string; lang: string }[];
  values: {
    demandsOwnerId: string | null;
    body: Readonly<Record<string, string>>;
    admissibleSourceKinds: SourceKind[];
    notMentionedSourceKinds: SourceKind[];
  };
  usage: Record<string, { quotes: number; checked: number }>;
  locales: LocaleOption[];
  text: MethodologyFormText;
}) => {
  const { pending, error, status, statusLine, run } = useWrite();
  const [constraint, setConstraint] = useState<string>();
  const [admissible, setAdmissible] = useState<SourceKind[]>(values.admissibleSourceKinds);
  const [notMentioned, setNotMentioned] = useState<SourceKind[]>(values.notMentionedSourceKinds);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const owner = new FormData(form).get('owner');
    setConstraint(undefined);
    const answer = await run(
      () =>
        sendToApi('PUT', path, {
          demandsOwnerId: demands && typeof owner === 'string' && owner !== '' ? owner : null,
          body: localizedFromForm(form, 'body', locales),
          admissibleSourceKinds: KINDS.filter((kind) => admissible.includes(kind)),
          notMentionedSourceKinds: KINDS.filter((kind) => notMentioned.includes(kind)),
        }),
      text.saved,
    );
    if (answer && !answer.ok) {
      setConstraint(answer.constraint);
    }
  };

  const kindsFieldset = (
    name: 'admissible' | 'notMentioned',
    legend: string,
    hint: string,
    chosen: SourceKind[],
    setChosen: (kinds: SourceKind[]) => void,
    was: SourceKind[],
    count: (kind: SourceKind) => number,
    removed: Partial<Record<SourceKind, string>>,
  ) => (
    <fieldset className={styles.fieldset} aria-describedby={`${name}-hint`}>
      <legend className={styles.label}>{legend}</legend>
      <p id={`${name}-hint`} className={styles.hint}>
        {hint}
      </p>
      {KINDS.map((kind) => {
        const id = `${name}-${kind}`;
        const used = usage[kind] ?? { quotes: 0, checked: 0 };
        const dropped = was.includes(kind) && !chosen.includes(kind) && count(kind) > 0;
        const describedBy = [
          used.quotes + used.checked > 0 ? `${id}-usage` : '',
          dropped ? `${id}-dropped` : '',
        ]
          .join(' ')
          .trim();
        return (
          <div key={kind} className={styles.checkboxField}>
            <input
              id={id}
              className={styles.checkbox}
              type="checkbox"
              checked={chosen.includes(kind)}
              onChange={(event) =>
                setChosen(
                  event.target.checked ? [...chosen, kind] : chosen.filter((k) => k !== kind),
                )
              }
              aria-describedby={describedBy || undefined}
            />
            <label htmlFor={id}>{text.kinds[kind]}</label>
            {used.quotes + used.checked > 0 ? (
              <span id={`${id}-usage`} className={styles.hint}>
                {text.usage[kind]}
              </span>
            ) : null}
            {/* A live region before its warning appears, so unticking the kind announces what it leaves. */}
            <span role="status" id={`${id}-dropped`}>
              {dropped ? (
                <strong className={styles.warning}>
                  <span aria-hidden="true">⚠ </span>
                  {removed[kind]}
                </strong>
              ) : null}
            </span>
          </div>
        );
      })}
    </fieldset>
  );

  return (
    <form className={styles.form} onSubmit={submit}>
      {demands ? (
        <div className={styles.field}>
          <label className={styles.label} htmlFor="methodology-owner">
            {text.owner}
          </label>
          <p id="methodology-owner-hint" className={styles.hint}>
            {text.ownerHint}
          </p>
          <select
            id="methodology-owner"
            className={styles.select}
            name="owner"
            required
            defaultValue={values.demandsOwnerId ?? owners[0]?.id ?? ''}
            aria-describedby="methodology-owner-hint"
          >
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id} lang={owner.lang}>
                {owner.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <LocalizedField
        name="body"
        label={text.body}
        hint={text.bodyHint}
        locales={locales}
        values={values.body}
        multiline
        maxLength={100_000}
        requiredLabel={text.needed}
        describedBy={error ? ERROR_ID : undefined}
      />
      {kindsFieldset(
        'admissible',
        text.admissible,
        text.admissibleHint,
        admissible,
        setAdmissible,
        values.admissibleSourceKinds,
        (kind) => usage[kind]?.quotes ?? 0,
        text.removedQuotes,
      )}
      {kindsFieldset(
        'notMentioned',
        text.notMentioned,
        text.notMentionedHint,
        notMentioned,
        setNotMentioned,
        values.notMentionedSourceKinds,
        (kind) => usage[kind]?.checked ?? 0,
        text.removedChecked,
      )}
      <FormMessages
        id={ERROR_ID}
        error={error}
        status={status}
        statusRef={statusLine}
        errors={
          error && constraint === 'methodologies_check1'
            ? { ...text.errors, [error]: text.kindsNeeded }
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
