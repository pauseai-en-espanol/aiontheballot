'use client';

import { type FormEvent, useEffect, useState } from 'react';

import { fill } from '@/fill';
import { FormMessages } from '@/ui/FormMessages';
import { formText } from '@/ui/forms';
import * as styles from '@/ui/styles';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

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
  errors: Record<WriteError, string>;
}

const ERROR_ID = 'quote-error';
/** How long typing must pause before the quote is checked: one request per pause, not per key. */
const PAUSE_MS = 400;

/**
 * Adds a quote to a draft (editorial workflow C2.4–7). As the editor types, it says whether the quote matches its
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
  /** The election's sources route in the API: a source's live match is under it. */
  matchBase: string;
  version: number;
  /** Each with its language, which a quote from it is in. */
  sources: { id: string; title: string; lang: string }[];
  text: QuoteFormText;
}) => {
  const { pending, error, status, statusLine, run } = useWrite();
  const [stale, setStale] = useState(false);
  const [source, setSource] = useState('');
  const [quote, setQuote] = useState('');
  const [live, setLive] = useState('');

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

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setStale(false);
    const answer = await run(
      () =>
        sendToApi('POST', path, {
          version,
          sourceId: source,
          quote,
          sectionLabel: formText(form, 'sectionLabel'),
        }),
      text.added,
    );
    if (answer?.ok) {
      setQuote('');
      form.reset();
    }
    if (answer?.error === 'cellChanged') {
      setStale(true);
    }
  };

  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="quote-source">
          {text.source}
        </label>
        <select
          id="quote-source"
          className={styles.select}
          name="sourceId"
          required
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
        </select>
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="quote-text">
          {text.quote}
        </label>
        <p id="quote-hint" className={styles.hint}>
          {text.quoteHint}
        </p>
        <textarea
          id="quote-text"
          className={styles.textarea}
          lang={sources.find((s) => s.id === source)?.lang}
          name="quote"
          required
          maxLength={4000}
          value={quote}
          onChange={(event) => {
            // The last answer was about the text before this change.
            setLive('');
            setQuote(event.target.value);
          }}
          aria-describedby={['quote-hint', 'quote-live', error ? ERROR_ID : '']
            .filter(Boolean)
            .join(' ')}
        />
        <p id="quote-live" className={styles.status} aria-live="polite">
          {source === '' || quote.trim() === '' ? '' : live}
        </p>
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="quote-section">
          {text.sectionLabel}
        </label>
        <p id="quote-section-hint" className={styles.hint}>
          {text.sectionLabelHint}
        </p>
        <input
          id="quote-section"
          className={styles.input}
          name="sectionLabel"
          maxLength={200}
          autoComplete="off"
          aria-describedby="quote-section-hint"
        />
      </div>
      <FormMessages
        id={ERROR_ID}
        statusRef={statusLine}
        error={stale ? undefined : error}
        status={status}
        errors={text.errors}
      />
      {stale ? <StaleNotice text={text} /> : null}
      <div>
        <button className={styles.button} type="submit" aria-disabled={pending}>
          {text.add}
        </button>
      </div>
    </form>
  );
};
