'use client';

import { type FormEvent, useState } from 'react';

import type { SourceKind } from '@/elections/data';

import { type Problems, type ProblemText, refusalProblem } from '@/ui/checks';
import { Field, FieldSelect } from '@/ui/Field';
import { FormActions } from '@/ui/FormActions';
import { FormMessages } from '@/ui/FormMessages';
import { formText, localizedFromForm } from '@/ui/forms';
import { type LocaleOption, LocalizedField } from '@/ui/LocalizedField';
import * as styles from '@/ui/styles';
import { useProblems } from '@/ui/useProblems';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

export interface MethodologyFormText {
  /** The body's Markdown views (PLAN R196). */
  markdown: { write: string; preview: string; empty: string };
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
  problems: ProblemText;
}

type MethodologyField = 'owner' | 'body' | 'admissible' | 'notMentioned';

const KINDS: readonly SourceKind[] = [
  'pdf',
  'web_page',
  'social_post',
  'video',
  'audio',
  'party_submission',
];
const ERROR_ID = 'methodology-error';

/** The request's fields, as the form names them. */
const BODY_FIELDS: Readonly<Record<string, MethodologyField>> = {
  demandsOwnerId: 'owner',
  body: 'body',
  admissibleSourceKinds: 'admissible',
  notMentionedSourceKinds: 'notMentioned',
};

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
  const { pending, error, status, statusLine, run, setError } = useWrite();
  const { problems, show, form: formRef } = useProblems<MethodologyField>();
  const [admissible, setAdmissible] = useState<SourceKind[]>(values.admissibleSourceKinds);
  const [notMentioned, setNotMentioned] = useState<SourceKind[]>(values.notMentionedSourceKinds);

  /** What the form can tell before sending (admin forms §1.2). */
  const check = (form: HTMLFormElement): Problems<MethodologyField> => {
    const found: Problems<MethodologyField> = {};
    if (demands && formText(form, 'owner') === '') {
      found.owner = text.problems.choose;
    }
    if (
      Object.values(localizedFromForm(form, 'body', locales)).every((value) => value.trim() === '')
    ) {
      found.body = text.problems.localized;
    }
    if (admissible.length === 0) {
      found.admissible = text.kindsNeeded;
    }
    if (notMentioned.length === 0) {
      found.notMentioned = text.kindsNeeded;
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
    const owner = formText(form, 'owner');
    const answer = await run(
      () =>
        sendToApi('PUT', path, {
          demandsOwnerId: demands && owner !== '' ? owner : null,
          body: localizedFromForm(form, 'body', locales),
          admissibleSourceKinds: KINDS.filter((kind) => admissible.includes(kind)),
          notMentionedSourceKinds: KINDS.filter((kind) => notMentioned.includes(kind)),
        }),
      text.saved,
    );
    if (answer && !answer.ok) {
      // A body with no text in any language is refused before the database, naming nothing.
      const pointed =
        refusalProblem(
          answer,
          {
            methodologies_check: ['owner', text.problems.choose],
            methodologies_check1: ['admissible', text.kindsNeeded],
          },
          Object.fromEntries(
            Object.entries(BODY_FIELDS).map(([name, field]) => [
              name,
              [field, text.problems.invalid],
            ]),
          ),
        ) ??
        (answer.error === 'incomplete' && answer.constraint === undefined
          ? { body: text.problems.localized }
          : undefined);
      if (pointed && show(pointed)) {
        setError(undefined);
      }
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
    <fieldset
      className={styles.fieldset}
      aria-describedby={[`${name}-hint`, problems[name] ? `${name}-error` : ''].join(' ').trim()}
    >
      <legend className={styles.label}>{legend}</legend>
      <p id={`${name}-hint`} className={styles.hint}>
        {hint}
      </p>
      {KINDS.map((kind, index) => {
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
              // The list's first box takes focus when the list is wrong, so its message is read.
              aria-invalid={index === 0 && problems[name] ? true : undefined}
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
      {problems[name] ? (
        <p id={`${name}-error`} className={styles.fieldError}>
          <span aria-hidden="true">⚠</span>
          <span>{problems[name]}</span>
        </p>
      ) : null}
    </fieldset>
  );

  return (
    <form ref={formRef} className={styles.form} onSubmit={submit} noValidate>
      {demands ? (
        <Field label={text.owner} hint={text.ownerHint} error={problems.owner} required>
          <FieldSelect
            className={styles.select}
            name="owner"
            defaultValue={values.demandsOwnerId ?? owners[0]?.id ?? ''}
          >
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id} lang={owner.lang}>
                {owner.name}
              </option>
            ))}
          </FieldSelect>
        </Field>
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
        error={problems.body}
        markdown={text.markdown}
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
      <FormMessages id={ERROR_ID} error={error} errors={text.errors} />
      <FormActions label={text.save} pending={pending} status={status} statusRef={statusLine} />
    </form>
  );
};
