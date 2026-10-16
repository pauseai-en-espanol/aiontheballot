'use client';

import { useId, useRef, useState } from 'react';

import { COLOUR, colourCode } from './colour';
import * as styles from './styles';

export interface ColourFieldText {
  /** "No colour". */
  none: string;
  choose: string;
  remove: string;
  /** The picker's name, for screen readers. */
  picker: string;
  /** The code's label: "Code (#rrggbb)". */
  code: string;
  cancel: string;
}

/**
 * A colour that may be left out (a party's, admin forms §1, "no default grey"): "No colour" until someone chooses one,
 * then the browser's picker beside its `#rrggbb` code, either of which sets it, and "Remove colour". The value is the
 * code as typed (lowercased), so the form can say when it isn't a colour; null is none.
 */
export const ColourField = ({
  label,
  hint,
  optional,
  value,
  onChange,
  error,
  text,
}: {
  label: string;
  hint?: string;
  optional?: string;
  value: string | null;
  onChange: (value: string | null) => void;
  error?: string;
  text: ColourFieldText;
}) => {
  const id = useId();
  const [open, setOpen] = useState(value !== null);
  const picker = useRef<HTMLInputElement>(null);
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  const showing = open || value !== null;
  return (
    <fieldset className={styles.fieldset} aria-describedby={describedBy || undefined}>
      <legend className={styles.label}>
        {label}
        {optional ? <span className={styles.optional}> ({optional})</span> : null}
      </legend>
      {hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      {showing ? (
        <div className={styles.inlineForm}>
          <input
            ref={picker}
            className={styles.colourInput}
            type="color"
            aria-label={text.picker}
            // The picker can't be empty: until a colour is chosen it shows black, and the value stays none.
            value={value !== null && COLOUR.test(value) ? value : '#000000'}
            onChange={(event) => onChange(event.target.value.toLowerCase())}
          />
          <div className={styles.field}>
            <label className={styles.hint} htmlFor={`${id}-code`}>
              {text.code}
            </label>
            <input
              id={`${id}-code`}
              className={styles.hexInput}
              value={value ?? ''}
              maxLength={7}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              onChange={(event) => {
                const code = colourCode(event.target.value);
                onChange(code === '' ? null : code);
              }}
            />
          </div>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => {
              setOpen(false);
              onChange(null);
            }}
          >
            {value === null ? text.cancel : text.remove}
          </button>
        </div>
      ) : (
        <div className={styles.inlineForm}>
          <span>{text.none}</span>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => {
              setOpen(true);
              requestAnimationFrame(() => picker.current?.focus());
            }}
          >
            {text.choose}
          </button>
        </div>
      )}
      {error ? (
        <p id={errorId} className={styles.fieldError}>
          <span aria-hidden="true">⚠</span>
          <span>{error}</span>
        </p>
      ) : null}
    </fieldset>
  );
};
