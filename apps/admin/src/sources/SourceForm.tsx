'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

import type { SourceKind } from '@/elections/data';

import { announce } from '@/ui/announce';
import {
  checkValues,
  constraintProblems,
  type Problems,
  type ProblemText,
  refusalProblem,
} from '@/ui/checks';
import { Field, FieldInput, FieldSelect } from '@/ui/Field';
import { FileField, type FileFieldText } from '@/ui/FileField';
import { FormActions } from '@/ui/FormActions';
import { FormMessages } from '@/ui/FormMessages';
import { formText } from '@/ui/forms';
import { LanguageSelect } from '@/ui/LanguageSelect';
import * as styles from '@/ui/styles';
import { useProblems } from '@/ui/useProblems';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, uploadToApi, type WriteError } from '@/write';

export interface SourceFormText {
  title: string;
  titleHint: string;
  kind: string;
  kinds: Record<SourceKind, string>;
  url: string;
  urlHint: string;
  language: string;
  languageHint: string;
  party: string;
  noParty: string;
  programme: string;
  programmeHint: string;
  optional: string;
  save: string;
  saved: string;
  /** Said on the new source's page, once it is added. */
  added: string;
  errors: Record<WriteError, string>;
  problems: ProblemText;
  constraints: Record<string, string>;
  languages: { none: string; others: string; other: string; code: string };
}

/** A new source's copy, chosen with it (admin forms §2, sources; PLAN R194): what this deployment offers, in words. */
export interface SourceCopyChoice {
  /** Whether copies can be stored here at all. */
  uploads: boolean;
  /** Whether one can be fetched from the source's address. */
  fetching: boolean;
  accept: readonly string[];
  maxBytes: number;
  text: {
    legend: string;
    later: string;
    upload: string;
    fetch: string;
    needsUrl: string;
    /** With `{error}`. */
    failed: string;
    file: string;
    fileHint: string;
    contributor: string;
    final: string;
    fileField: FileFieldText;
  };
}

type SourceField = 'title' | 'kind' | 'url' | 'language' | 'party' | 'programme' | 'copy';

const ERROR_ID = 'source-error';
const KINDS: readonly SourceKind[] = [
  'pdf',
  'web_page',
  'social_post',
  'video',
  'audio',
  'party_submission',
];
/** A language as `app.locale` takes it, once lowercased. */
const LANGUAGE = /^[a-z]{2}(?:-[a-z]{2})?$/u;

/** The field each constraint the database names is about. */
const CONSTRAINT_FIELDS: Readonly<Record<string, SourceField>> = {
  source_documents_url_check: 'url',
  locale_check: 'language',
  source_documents_check2: 'programme',
};

/** The request's fields, as the form names them, with the constraint whose words fit a refusal of each. */
const BODY_FIELDS: Readonly<Record<string, readonly [SourceField, string?]>> = {
  title: ['title'],
  kind: ['kind'],
  url: ['url', 'source_documents_url_check'],
  language: ['language', 'locale_check'],
  partyId: ['party'],
  isProgramme: ['programme'],
};

/**
 * A source's fields (editorial workflow S1.1): its kind, title as published, address, language, party (or none, for a
 * party-neutral document) and whether it is that party's programme. They change only until a copy is stored (S1.2),
 * which the database enforces; the page stops offering this form then. What is wrong shows at its field, in words, and
 * the first takes focus (admin forms §1.2). An edit stays on the page and says so beside the button; a new source's own
 * page opens and says it was added (§1.4). A new one's copy can be chosen with it, a file to upload or its address to
 * fetch, stored right after the source is (PLAN R194); if that fails, the source is kept and its page says why.
 */
export const SourceForm = ({
  path,
  method,
  then,
  values,
  parties,
  siteLanguages,
  locale,
  copy,
  text,
}: {
  path: string;
  method: 'POST' | 'PUT';
  /** Where a new source's page is: its id, which the API answers with, is appended to it. */
  then?: string;
  values?: {
    title: string;
    kind: SourceKind;
    url: string | null;
    language: string | null;
    partyId: string | null;
    isProgramme: boolean;
  };
  parties: { id: string; name: string; lang: string }[];
  /** The site's languages, its main one first: offered first, the main one for a new source. */
  siteLanguages: string[];
  /** The admin's language. */
  locale: string;
  /** For a new source: its copy, chosen with it. */
  copy?: SourceCopyChoice;
  text: SourceFormText;
}) => {
  const router = useRouter();
  const { pending, error, status, statusLine, run, setError } = useWrite();
  const { problems, show, form: formRef } = useProblems<SourceField>();
  const [partyId, setPartyId] = useState(values?.partyId ?? '');
  const [copyChoice, setCopyChoice] = useState<'later' | 'upload' | 'fetch'>('later');
  const [file, setFile] = useState<File | null>(null);
  const constraintMessage = (constraint: string, fallback: string) =>
    text.constraints[constraint] ?? fallback;

  /** What the form can tell before sending (admin forms §1.2). */
  const check = (form: HTMLFormElement): Problems<SourceField> => {
    const found: Problems<SourceField> = checkValues(
      { title: formText(form, 'title').trim(), url: formText(form, 'url').trim() },
      { title: { required: true }, url: { shape: 'url' } },
      text.problems,
    );
    if (found.url) {
      found.url = constraintMessage('source_documents_url_check', found.url);
    }
    const language = formText(form, 'language').trim().toLowerCase();
    if (language !== '' && !LANGUAGE.test(language)) {
      found.language = constraintMessage('locale_check', text.problems.invalid);
    }
    if (copy && copyChoice === 'upload' && file === null) {
      found.copy = copy.text.fileField.problems.missing;
    }
    if (copy && copyChoice === 'fetch' && formText(form, 'url').trim() === '' && !found.url) {
      found.url = copy.text.needsUrl;
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
    const data = new FormData(form);
    const answer = await run(
      () =>
        sendToApi(method, path, {
          title: formText(form, 'title').trim(),
          kind: formText(form, 'kind'),
          url: formText(form, 'url').trim() || null,
          language: formText(form, 'language').trim().toLowerCase() || null,
          partyId: partyId || null,
          isProgramme: partyId !== '' && data.get('isProgramme') === 'on',
        }),
      method === 'POST' ? () => undefined : text.saved,
    );
    if (answer && !answer.ok) {
      const pointed = refusalProblem(
        answer,
        constraintProblems(CONSTRAINT_FIELDS, text.constraints, text.problems.invalid),
        Object.fromEntries(
          Object.entries(BODY_FIELDS).map(([name, [field, constraint]]) => [
            name,
            [
              field,
              constraint
                ? constraintMessage(constraint, text.problems.invalid)
                : text.problems.invalid,
            ],
          ]),
        ),
      );
      if (pointed && show(pointed)) {
        setError(undefined);
      }
      return;
    }
    if (answer?.ok && method === 'POST' && then !== undefined) {
      const id =
        typeof answer.body === 'object' && answer.body !== null
          ? (answer.body as { id?: unknown }).id
          : undefined;
      // Its copy, now that it exists: kept or not, the source is, and its page says which.
      const stored =
        typeof id !== 'string' || !copy || copyChoice === 'later'
          ? { ok: true }
          : copyChoice === 'upload' && file
            ? await uploadToApi(`${path}/${id}/copy`, file)
            : copyChoice === 'fetch'
              ? await sendToApi('POST', `${path}/${id}/fetch`)
              : { ok: true };
      announce(
        stored.ok || !copy
          ? text.added
          : copy.text.failed.replace('{error}', text.errors[stored.error ?? 'unexpected']),
        { afterNavigation: true },
      );
      router.push(typeof id === 'string' ? `${then}/${id}` : then);
    }
  };

  return (
    <form ref={formRef} className={styles.form} onSubmit={submit} noValidate>
      <Field label={text.title} hint={text.titleHint} error={problems.title} required>
        <FieldInput
          className={styles.input}
          name="title"
          maxLength={500}
          defaultValue={values?.title ?? ''}
        />
      </Field>
      <Field label={text.kind} error={problems.kind}>
        <FieldSelect className={styles.select} name="kind" defaultValue={values?.kind ?? 'pdf'}>
          {KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {text.kinds[kind]}
            </option>
          ))}
        </FieldSelect>
      </Field>
      <Field label={text.url} hint={text.urlHint} optional={text.optional} error={problems.url}>
        <FieldInput
          className={styles.input}
          name="url"
          type="url"
          maxLength={2048}
          placeholder="https://"
          autoComplete="off"
          defaultValue={values?.url ?? ''}
        />
      </Field>
      <LanguageSelect
        name="language"
        value={values ? (values.language ?? '') : (siteLanguages[0] ?? '')}
        site={siteLanguages}
        locale={locale}
        label={text.language}
        hint={text.languageHint}
        optional={text.optional}
        error={problems.language}
        text={text.languages}
      />
      <Field label={text.party} error={problems.party}>
        <FieldSelect
          className={styles.select}
          name="partyId"
          value={partyId}
          onChange={(event) => setPartyId(event.target.value)}
        >
          <option value="">{text.noParty}</option>
          {parties.map((party) => (
            <option key={party.id} value={party.id} lang={party.lang}>
              {party.name}
            </option>
          ))}
        </FieldSelect>
      </Field>
      {partyId === '' ? null : (
        <div className={styles.field}>
          <div className={styles.checkboxField}>
            <input
              id="source-programme"
              className={styles.checkbox}
              type="checkbox"
              name="isProgramme"
              defaultChecked={values?.isProgramme ?? false}
              aria-invalid={problems.programme ? true : undefined}
              aria-describedby={[
                'source-programme-hint',
                problems.programme ? 'source-programme-error' : '',
              ]
                .join(' ')
                .trim()}
            />
            <label htmlFor="source-programme">{text.programme}</label>
          </div>
          <p id="source-programme-hint" className={styles.hint}>
            {text.programmeHint}
          </p>
          {problems.programme ? (
            <p id="source-programme-error" className={styles.fieldError}>
              <span aria-hidden="true">⚠</span>
              <span>{problems.programme}</span>
            </p>
          ) : null}
        </div>
      )}
      {copy?.uploads ? (
        <fieldset className={styles.fieldset}>
          <legend className={styles.label}>{copy.text.legend}</legend>
          {(['later', 'upload', ...(copy.fetching ? (['fetch'] as const) : [])] as const).map(
            (choice) => (
              <div key={choice} className={styles.checkboxField}>
                <input
                  id={`source-copy-${choice}`}
                  className={styles.checkbox}
                  type="radio"
                  name="copyChoice"
                  value={choice}
                  checked={copyChoice === choice}
                  onChange={() => setCopyChoice(choice)}
                />
                <label htmlFor={`source-copy-${choice}`}>{copy.text[choice]}</label>
              </div>
            ),
          )}
          {copyChoice === 'later' ? null : (
            <>
              <p id="source-copy-contributor" className={styles.notice}>
                {copy.text.contributor}
              </p>
              <p className={styles.hint}>{copy.text.final}</p>
            </>
          )}
          {copyChoice === 'upload' ? (
            <FileField
              label={copy.text.file}
              hint={copy.text.fileHint}
              accept={copy.accept}
              maxBytes={copy.maxBytes}
              value={file}
              onChange={setFile}
              error={problems.copy}
              describedBy="source-copy-contributor"
              locale={locale}
              text={copy.text.fileField}
            />
          ) : null}
        </fieldset>
      ) : null}
      <FormMessages id={ERROR_ID} error={error} errors={text.errors} />
      <FormActions label={text.save} pending={pending} status={status} statusRef={statusLine} />
    </form>
  );
};
