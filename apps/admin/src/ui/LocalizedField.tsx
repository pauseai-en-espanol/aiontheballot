'use client';

import { Tabs } from '@ark-ui/react/tabs';
import { useEffect, useRef, useState } from 'react';

import * as styles from './styles';

/** A language the tenant enables, named in the admin's language, and whether publishing will need text in it. */
export interface LocaleOption {
  code: string;
  label: string;
  required: boolean;
}

/**
 * A localized field (editorial workflow §2.4): one tab per language the tenant enables, its default language first
 * and marked as needed to publish, on its tab and in its input's name. Every tab's input stays in the form, named
 * `{name}.{code}`, and carries its language (`lang`), so spell checkers and screen readers read it as written. A form
 * can bring one language forward (`show`), as after a refusal that names it: its tab opens and its input takes focus.
 */
export const LocalizedField = ({
  name,
  label,
  hint,
  locales,
  values = {},
  multiline = false,
  maxLength,
  requiredLabel,
  describedBy,
  show,
}: {
  name: string;
  label: string;
  hint?: string;
  locales: LocaleOption[];
  values?: Readonly<Record<string, string>>;
  multiline?: boolean;
  maxLength: number;
  /** "needed to publish", shown on the default language's tab and in its input's name. */
  requiredLabel: string;
  /** The form's error, once there is one. */
  describedBy?: string;
  /** A language to bring forward, with a count that changes each time it is asked for again. */
  show?: { code: string; times: number };
}) => {
  const [selected, setSelected] = useState(locales[0]?.code ?? '');
  // A new request to show a language selects its tab during render (React's pattern for state that follows props),
  // and the effect then moves focus, which is the DOM's, into its input.
  // A request made before this field was mounted (it remounts after a publish) isn't a new one.
  const [shown, setShown] = useState(show?.times);
  const focused = useRef(show?.times);
  if (show && show.times !== shown) {
    setShown(show.times);
    setSelected(show.code);
  }
  useEffect(() => {
    if (show && show.times !== focused.current) {
      focused.current = show.times;
      requestAnimationFrame(() => document.getElementById(`${name}-${show.code}`)?.focus());
    }
  }, [show, name]);
  const hintId = hint ? `${name}-hint` : undefined;
  const described = [hintId, describedBy].filter(Boolean).join(' ') || undefined;
  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.label}>{label}</legend>
      {hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      <Tabs.Root value={selected} onValueChange={({ value }) => setSelected(value)}>
        <Tabs.List className={styles.tabList} aria-label={label}>
          {locales.map((locale) => (
            <Tabs.Trigger key={locale.code} value={locale.code} className={styles.tab}>
              {locale.label}
              {locale.required ? ` (${requiredLabel})` : null}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {locales.map((locale) => {
          const id = `${name}-${locale.code}`;
          const common = {
            id,
            name: `${name}.${locale.code}`,
            lang: locale.code,
            defaultValue: values[locale.code] ?? '',
            maxLength,
            'aria-describedby': described,
          };
          return (
            <Tabs.Content key={locale.code} value={locale.code} className={styles.tabPanel}>
              <label className={styles.visuallyHidden} htmlFor={id}>
                {locale.required
                  ? `${label} (${locale.label}, ${requiredLabel})`
                  : `${label} (${locale.label})`}
              </label>
              {multiline ? (
                <textarea className={styles.textarea} {...common} />
              ) : (
                <input className={styles.input} type="text" {...common} />
              )}
            </Tabs.Content>
          );
        })}
      </Tabs.Root>
    </fieldset>
  );
};
