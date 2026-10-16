'use client';

import { renderMarkdown } from '@aiontheballot/domain/markdown';
import { Tabs } from '@ark-ui/react/tabs';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import * as styles from './styles';

/** A language the tenant enables, named in the admin's language, and whether publishing will need text in it. */
export interface LocaleOption {
  code: string;
  label: string;
  /** Its name as a sentence has it, where that differs from a label's ("español"). */
  name?: string;
  required: boolean;
}

/**
 * A localized field (editorial workflow §2.4): one tab per language the tenant enables, its default language first
 * and marked as needed to publish, on its tab and in its input's name. Every tab's input stays in the form, named
 * `{name}.{code}`, and carries its language (`lang`), so spell checkers and screen readers read it as written. A form
 * can bring one language forward (`show`), as after a refusal that names it: its tab opens and its input takes focus.
 * A Markdown text (`markdown`: the methodology, the legal texts) grows with what is typed and shows, per language, a
 * preview rendered as the public site renders it (admin forms §1.9, PLAN R196), the text staying in the form meanwhile.
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
  error,
  optional,
  markdown,
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
  /** What is wrong with this field, after a submit (admin forms §1.2): under it, and its inputs marked. */
  error?: string;
  /** "(optional)", for a field that may be left empty. */
  optional?: string;
  /** A Markdown text's words: its two views, and what an empty preview says. */
  markdown?: { write: string; preview: string; empty: string };
}) => {
  // The languages whose preview is shown, each with the text it shows.
  const [previews, setPreviews] = useState<Readonly<Record<string, string>>>({});
  const textOf = (code: string) =>
    (document.getElementById(`${name}-${code}`) as HTMLTextAreaElement | null)?.value ?? '';
  /** As tall as its text, so a long text reads without a box to scroll. */
  const grow = (area: HTMLTextAreaElement) => {
    area.style.height = 'auto';
    area.style.height = `${area.scrollHeight + 2}px`;
  };
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
  const errorId = error ? `${name}-error` : undefined;
  const described = [hintId, errorId, describedBy].filter(Boolean).join(' ') || undefined;
  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.label}>
        {label}
        {optional ? <span className={styles.optional}> ({optional})</span> : null}
      </legend>
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
            // Content, never the user's own details: browsers offer saved addresses on a field named like a name.
            autoComplete: 'off',
            'aria-describedby': described,
            'aria-invalid': error ? true : undefined,
          };
          return (
            <Tabs.Content key={locale.code} value={locale.code} className={styles.tabPanel}>
              <label className={styles.visuallyHidden} htmlFor={id}>
                {locale.required
                  ? `${label} (${locale.label}, ${requiredLabel})`
                  : `${label} (${locale.label})`}
              </label>
              {multiline && markdown ? (
                <>
                  <div className={styles.buttonRow}>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      aria-pressed={previews[locale.code] === undefined}
                      onClick={() => setPreviews(({ [locale.code]: _, ...rest }) => rest)}
                    >
                      {markdown.write}
                    </button>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      aria-pressed={previews[locale.code] !== undefined}
                      onClick={() =>
                        setPreviews((shown) => ({ ...shown, [locale.code]: textOf(locale.code) }))
                      }
                    >
                      {markdown.preview}
                    </button>
                  </div>
                  <textarea
                    className={styles.textarea}
                    {...common}
                    hidden={previews[locale.code] !== undefined}
                    ref={(area) => {
                      if (area) {
                        grow(area);
                      }
                    }}
                    onInput={(event: FormEvent<HTMLTextAreaElement>) => grow(event.currentTarget)}
                  />
                  {previews[locale.code] === undefined ? null : previews[locale.code]?.trim() ===
                    '' ? (
                    <p className={styles.hint}>{markdown.empty}</p>
                  ) : (
                    <div
                      className={styles.markdownPreview}
                      lang={locale.code}
                      // The same renderer as the public site's: raw HTML escaped, only http(s) and mailto links.
                      // oxlint-disable-next-line react/no-danger
                      dangerouslySetInnerHTML={{
                        __html: renderMarkdown(previews[locale.code] ?? ''),
                      }}
                    />
                  )}
                </>
              ) : multiline ? (
                <textarea className={styles.textarea} {...common} />
              ) : (
                <input className={styles.input} type="text" {...common} />
              )}
            </Tabs.Content>
          );
        })}
      </Tabs.Root>
      {error ? (
        <p id={errorId} className={styles.fieldError}>
          <span aria-hidden="true">⚠</span>
          <span>{error}</span>
        </p>
      ) : null}
    </fieldset>
  );
};
