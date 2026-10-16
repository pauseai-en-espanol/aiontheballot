'use client';

import { useEffect, useRef, useState } from 'react';

import { fill } from '@/fill';
import * as styles from '@/ui/styles';

import { pickQuote, type PickUnit } from './pick';
import { selectedParts } from './selection';

export interface QuotePickerText {
  title: string;
  hint: string;
  button: string;
  loading: string;
  failed: string;
  none: string;
  nothing: string;
  tooLong: string;
  done: string;
}

const isUnits = (value: unknown): value is PickUnit[] =>
  Array.isArray(value) &&
  value.every(
    (unit: unknown) =>
      typeof unit === 'object' &&
      unit !== null &&
      typeof (unit as PickUnit).label === 'string' &&
      typeof (unit as PickUnit).body === 'string',
  );

/**
 * A source's extracted text by page or section, beside the quote form (editorial workflow C2): the editor selects a
 * passage and uses it, which fills the quote as it is in the text and the page it is on. It is the text quotes are
 * matched against, read from the API under RLS like the source's own page (S6.2: members only), and shown as text,
 * never as markup. The database matches the quote again on save. Keyed by its source: another source is another
 * picker.
 */
export const QuotePicker = ({
  url,
  lang,
  text,
  onPick,
}: {
  /** The source's route in the API, which answers with its units. */
  url: string;
  /** The source's language, which its text is in. */
  lang: string;
  text: QuotePickerText;
  onPick: (picked: { quote: string; label: string }) => void;
}) => {
  const [units, setUnits] = useState<PickUnit[] | 'failed'>();
  const [status, setStatus] = useState('');
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(String(response.status));
        }
        const answer = ((await response.json()) as { units?: unknown }).units;
        if (!isUnits(answer)) {
          throw new Error("The source's text isn't what the admin expects");
        }
        setUnits(answer);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) {
          console.error("The source's text couldn't be loaded", failure);
          setUnits('failed');
        }
      });
    return () => {
      controller.abort();
    };
  }, [url]);

  const pick = () => {
    if (!Array.isArray(units) || !panel.current) {
      return;
    }
    const picked = pickQuote(units, selectedParts(panel.current));
    if (picked.kind === 'empty') {
      setStatus(text.nothing);
    } else if (picked.kind === 'too-long') {
      setStatus(fill(text.tooLong, { length: String(picked.length) }));
    } else {
      setStatus(fill(text.done, { location: picked.label }));
      onPick(picked);
    }
  };

  return (
    <div>
      <h5 id="quote-pick-title" className={styles.label}>
        {text.title}
      </h5>
      {units === undefined ? (
        <p className={styles.hint} role="status">
          {text.loading}
        </p>
      ) : units === 'failed' ? (
        <p className={styles.notice}>{text.failed}</p>
      ) : units.length === 0 ? (
        <p className={styles.text}>{text.none}</p>
      ) : (
        <>
          <p id="quote-pick-hint" className={styles.hint}>
            {text.hint}
          </p>
          {/* A region of its own that scrolls, so it takes focus for the keyboard to scroll it. */}
          <div
            ref={panel}
            className={styles.sourceText}
            role="region"
            aria-labelledby="quote-pick-title"
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
            lang={lang}
          >
            {units.map((unit, position) => (
              // Units come in order and never change once extracted: their place is their key.
              // oxlint-disable-next-line react/no-array-index-key
              <div key={position} className={styles.unit}>
                <p className={styles.unitLabel}>{unit.label}</p>
                {/* One text node: the selection is read against it (selection.ts). */}
                <p className={styles.prose} data-unit={position}>
                  {unit.body}
                </p>
              </div>
            ))}
          </div>
          <button
            className={styles.secondaryButton}
            type="button"
            aria-describedby="quote-pick-hint"
            // Pressing the button must not move the selection it is about to read.
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={pick}
          >
            {text.button}
          </button>
          <p className={styles.status} aria-live="polite">
            {status}
          </p>
        </>
      )}
    </div>
  );
};
