'use client';

import { type FormEvent, useEffect, useRef, useState } from 'react';

import { fill } from '@/fill';
import { type Problems, type ProblemText, refusalProblem } from '@/ui/checks';
import { Field, FieldInput, FieldSelect } from '@/ui/Field';
import { FormActions } from '@/ui/FormActions';
import { FormMessages } from '@/ui/FormMessages';
import { formText } from '@/ui/forms';
import * as styles from '@/ui/styles';
import { useProblems } from '@/ui/useProblems';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

import { announceOwnChange } from './own-version';
import { QuotePicker, type QuotePickerText } from './QuotePicker';
import { StaleNotice } from './StaleNotice';

/** What the API's live match answers (packages/domain's quote-match, the database's rule step for step). */
type LiveMatch =
  | { kind: 'matched'; span: { location: string } }
  | { kind: 'too-short'; length: number; counted: 'stored' | 'normalised' }
  | { kind: 'too-long'; length: number }
  | {
      kind: 'unmatched';
      longest: { part: 'start' | 'end'; text: string; location: string } | null;
    };

export interface QuoteFormText {
  source: string;
  chooseSource: string;
  quote: string;
  quoteHint: string;
  sectionLabel: string;
  sectionLabelHint: string;
  add: string;
  added: string;
  stale: string;
  reload: string;
  live: {
    matched: string;
    tooShortStored: string;
    tooShortNormalised: string;
    tooLong: string;
    unmatched: string;
    longestStart: string;
    longestEnd: string;
    failed: string;
  };
  pick: QuotePickerText;
  optional: string;
  errors: Record<WriteError, string>;
  problems: ProblemText;
}

type QuoteField = 'source' | 'quote' | 'sectionLabel';

const ERROR_ID = 'quote-error';
const QUOTE_ERROR_ID = 'quote-text-error';

/** The field each refusal the database or the API's schema names is about. */
const CONSTRAINT_FIELDS: Readonly<Record<string, QuoteField>> = {
  draft_evidence_quote_check: 'quote',
};
const BODY_FIELDS: Readonly<Record<string, QuoteField>> = {
  sourceId: 'source',
  quote: 'quote',
  sectionLabel: 'sectionLabel',
};
/** How long typing must pause before the quote is checked: one request per pause, not per key. */
const PAUSE_MS = 400;

/**
 * Adds a quote to a draft (editorial workflow C2.4–7). Once a source is chosen, its text is shown beside the form, and
 * a passage selected there fills the quote and its page. As the editor types, it says whether the quote matches its
 * source and on which pages, or how much of it does (W13), in a polite live region; the database decides on save, and
 * a status the client sends is never used.
 */
export const QuoteForm = ({
  path,
  matchBase,
  version,
  sources,
  text,
}: {
  /** The cell's quotes route in the API. */
  path: string;
  /** The election's sources route in the API: each source, with its text, and its live match are under it. */
  matchBase: string;
  version: number;
  /** Each with its language, which a quote from it is in. */
  sources: { id: string; title: string; lang: string }[];
  text: QuoteFormText;
}) => {
  const { pending, error, status, statusLine, run, setError } = useWrite();
  const { problems, show, form: formRef } = useProblems<QuoteField>();
  const [stale, setStale] = useState(false);
  const [source, setSource] = useState('');
  const [quote, setQuote] = useState('');
  const [sectionLabel, setSectionLabel] = useState('');
  const [live, setLive] = useState('');
  const quoteField = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Nothing to check: the line is hidden below, so the last answer needs no clearing.
    if (source === '' || quote.trim() === '') {
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetch(`${matchBase}/${encodeURIComponent(source)}/match`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quote }),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(String(response.status));
          }
          const match = (await response.json()) as LiveMatch;
          setLive(
            match.kind === 'matched'
              ? fill(text.live.matched, { location: match.span.location })
              : match.kind === 'too-long'
                ? fill(text.live.tooLong, { length: String(match.length) })
                : match.kind === 'too-short'
                  ? fill(
                      match.counted === 'stored'
                        ? text.live.tooShortStored
                        : text.live.tooShortNormalised,
                      { length: String(match.length) },
                    )
                  : [
                      text.live.unmatched,
                      match.longest
                        ? fill(
                            match.longest.part === 'start'
                              ? text.live.longestStart
                              : text.live.longestEnd,
                            { text: match.longest.text, location: match.longest.location },
                          )
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' '),
          );
        })
        .catch((failure: unknown) => {
          if (!controller.signal.aborted) {
            console.error('The live match failed', failure);
            setLive(text.live.failed);
          }
        });
    }, PAUSE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [source, quote, matchBase, text.live]);

  /** What the form can tell before sending (admin forms §1.2): a source, and a quote of the length the database takes. */
  const check = (): Problems<QuoteField> => {
    const found: Problems<QuoteField> = {};
    const length = quote.trim().length;
    if (source === '') {
      found.source = text.problems.choose;
    }
    if (length === 0) {
      found.quote = text.problems.required;
    } else if (length < 15) {
      found.quote = fill(text.live.tooShortStored, { length: String(length) });
    } else if (length > 1000) {
      found.quote = fill(text.live.tooLong, { length: String(length) });
    }
    return found;
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setStale(false);
    if (show(check())) {
      setError(undefined);
      return;
    }
    const answer = await run(async () => {
      const sent = await sendToApi('POST', path, {
        version,
        sourceId: source,
        quote,
        sectionLabel: formText(form, 'sectionLabel'),
      });
      // The draft's form keeps what is being typed in it (R190).
      if (sent.ok) {
        announceOwnChange(version, sent.body);
      }
      return sent;
    }, text.added);
    if (answer?.ok) {
      setQuote('');
      setSectionLabel('');
      form.reset();
    }
    if (answer?.error === 'cellChanged') {
      setStale(true);
    } else if (answer && !answer.ok) {
      const pointed = refusalProblem(
        answer,
        Object.fromEntries(
          Object.entries(CONSTRAINT_FIELDS).map(([name, field]) => [name, [field, text.quoteHint]]),
        ),
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
    }
  };

  const chosen = sources.find((s) => s.id === source);

  return (
    <div className={styles.quoteLayout}>
      <form ref={formRef} className={styles.form} onSubmit={submit} noValidate>
        <Field label={text.source} error={problems.source} required>
          <FieldSelect
            className={styles.select}
            name="sourceId"
            value={source}
            onChange={(event) => {
              setLive('');
              setSource(event.target.value);
            }}
          >
            <option value="" disabled>
              {text.chooseSource}
            </option>
            {sources.map((s) => (
              <option key={s.id} value={s.id} lang={s.lang}>
                {s.title}
              </option>
            ))}
          </FieldSelect>
        </Field>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="quote-text">
            {text.quote}
          </label>
          <p id="quote-hint" className={styles.hint}>
            {text.quoteHint}
          </p>
          <textarea
            id="quote-text"
            ref={quoteField}
            className={styles.textarea}
            lang={chosen?.lang}
            name="quote"
            maxLength={4000}
            aria-invalid={problems.quote === undefined ? undefined : true}
            value={quote}
            onChange={(event) => {
              // The last answer was about the text before this change.
              setLive('');
              setQuote(event.target.value);
            }}
            aria-describedby={[
              'quote-hint',
              'quote-live',
              problems.quote === undefined ? '' : QUOTE_ERROR_ID,
              error ? ERROR_ID : '',
            ]
              .filter(Boolean)
              .join(' ')}
          />
          {problems.quote === undefined ? null : (
            <p id={QUOTE_ERROR_ID} className={styles.fieldError}>
              <span aria-hidden="true">⚠</span>
              <span>{problems.quote}</span>
            </p>
          )}
          <p id="quote-live" className={styles.status} aria-live="polite">
            {source === '' || quote.trim() === '' ? '' : live}
          </p>
        </div>
        <Field
          label={text.sectionLabel}
          hint={text.sectionLabelHint}
          optional={text.optional}
          error={problems.sectionLabel}
        >
          <FieldInput
            className={styles.input}
            name="sectionLabel"
            maxLength={200}
            autoComplete="off"
            value={sectionLabel}
            onChange={(event) => {
              setSectionLabel(event.target.value);
            }}
          />
        </Field>
        <FormMessages id={ERROR_ID} error={stale ? undefined : error} errors={text.errors} />
        {stale ? <StaleNotice text={text} /> : null}
        <FormActions label={text.add} pending={pending} status={status} statusRef={statusLine} />
      </form>
      {chosen ? (
        <QuotePicker
          key={chosen.id}
          url={`${matchBase}/${encodeURIComponent(chosen.id)}`}
          lang={chosen.lang}
          text={text.pick}
          onPick={(picked) => {
            setLive('');
            setQuote(picked.quote);
            setSectionLabel(picked.label);
            quoteField.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
};
