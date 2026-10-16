'use client';

import { useId, useMemo, useState } from 'react';

import { Field, FieldSelect } from './Field';
import * as styles from './styles';

/** Languages offered beyond the site's own, by their codes: the EU's and a few more a source is often in. */
const COMMON = [
  'ar',
  'bg',
  'ca',
  'cs',
  'da',
  'de',
  'el',
  'en',
  'es',
  'et',
  'eu',
  'fi',
  'fr',
  'ga',
  'gl',
  'hr',
  'hu',
  'it',
  'ja',
  'lt',
  'lv',
  'mt',
  'nl',
  'pl',
  'pt',
  'ro',
  'ru',
  'sk',
  'sl',
  'sv',
  'uk',
  'zh',
] as const;

const OTHER = 'other';

/**
 * A language, chosen by its name (admin forms §1.6, PLAN R194): the site's languages first, then others in the admin's
 * language, then "another", by its code (`xx` or `xx-yy`), for one not listed. The form reads the code from `name`.
 */
export const LanguageSelect = ({
  name,
  value,
  site,
  locale,
  label,
  hint,
  optional,
  error,
  text,
}: {
  name: string;
  value: string;
  /** The site's languages, its main one first. */
  site: readonly string[];
  /** The admin's language, which the names are in. */
  locale: string;
  label: string;
  hint?: string;
  optional?: string;
  error?: string | undefined;
  text: { none: string; others: string; other: string; code: string };
}) => {
  const id = useId();
  const names = useMemo(() => new Intl.DisplayNames([locale], { type: 'language' }), [locale]);
  const nameOf = (code: string) => {
    const shown = names.of(code) ?? code;
    return shown.charAt(0).toLocaleUpperCase(locale) + shown.slice(1);
  };
  const others = useMemo(
    () =>
      COMMON.filter((code) => !site.includes(code))
        .map((code) => ({ code, name: nameOf(code) }))
        .sort((a, b) => a.name.localeCompare(b.name, locale)),
    // nameOf follows names and locale.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [site, names, locale],
  );
  const listed = (code: string) =>
    code === '' || site.includes(code) || (COMMON as readonly string[]).includes(code);
  const [choice, setChoice] = useState(listed(value) ? value : OTHER);
  const [code, setCode] = useState(listed(value) ? '' : value);
  const chosen = choice === OTHER ? code.trim().toLowerCase() : choice;
  return (
    <>
      <Field label={label} hint={hint} optional={optional} error={error}>
        <FieldSelect
          className={styles.select}
          value={choice}
          onChange={(event) => setChoice(event.target.value)}
        >
          <option value="">{text.none}</option>
          {site.map((language) => (
            <option key={language} value={language}>
              {nameOf(language)}
            </option>
          ))}
          <optgroup label={text.others}>
            {others.map((language) => (
              <option key={language.code} value={language.code}>
                {language.name}
              </option>
            ))}
          </optgroup>
          <option value={OTHER}>{text.other}</option>
        </FieldSelect>
      </Field>
      {choice === OTHER ? (
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${id}-code`}>
            {text.code}
          </label>
          <input
            id={`${id}-code`}
            className={styles.input}
            value={code}
            maxLength={5}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setCode(event.target.value)}
            aria-invalid={error ? true : undefined}
          />
        </div>
      ) : null}
      <input type="hidden" name={name} value={chosen} />
    </>
  );
};
