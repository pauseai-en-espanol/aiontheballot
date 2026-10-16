'use client';

import { type KeyboardEvent, useId, useState } from 'react';
import { flushSync } from 'react-dom';

import { fill } from '@/fill';

import { FieldSelect } from './Field';
import * as styles from './styles';
import { findTerritories, type Territory, territoryGroups } from './territory-tree';

export interface TerritoryPickerText {
  find: string;
  findHint: string;
  /** A group's subdivisions, folded: with `{name}` and `{count}`. */
  within: string;
  /** With `{list}`. */
  chosen: string;
  noneChosen: string;
  noMatch: string;
  /** Codes saved before that the list hasn't. */
  other: string;
  /** A territory's select, left empty where it may be. */
  whole: string;
  /** A territory's select, left empty where it may not be. */
  choose: string;
}

/** From this many subdivisions on, a box finds them by name or code. */
const FIND_FROM = 20;

const shown = (territory: Territory): string => `${territory.name} (${territory.code})`;

/**
 * The territories something stands in, ticked from its site's country's subdivisions (ISO 3166-2; PLAN R201) rather
 * than typed as codes: those directly under the country, each with the ones inside it folded under it, open where one
 * is ticked, and a box that finds any by name or code. The form gets the codes as one text in `name`, as the code
 * field gave them, so what reads, checks and sends them is unchanged. A code saved before that the list hasn't stays
 * ticked under its own heading, kept unless unticked. Place names are proper names, so they carry no `lang`.
 */
export const TerritoryPicker = ({
  name,
  label,
  hint,
  optional,
  error,
  territories,
  initial,
  locale,
  onChange,
  text,
}: {
  name: string;
  label: string;
  hint?: string;
  optional?: string;
  error?: string;
  /** The site's country's subdivisions: never none, since a country without them keeps the code field. */
  territories: readonly Territory[];
  initial: readonly string[];
  locale: string;
  /** Told when the codes change: the hidden input they're in sends no input event. */
  onChange?: () => void;
  text: TerritoryPickerText;
}) => {
  const id = useId();
  const [chosen, setChosen] = useState<string[]>(() => [...new Set(initial)]);
  const [query, setQuery] = useState('');
  const known = new Map(territories.map((territory) => [territory.code, territory]));
  const groups = territoryGroups(territories, locale);
  // Opened at first where one inside is ticked; then as the person leaves it.
  const [opened] = useState(
    () =>
      new Set(
        groups
          .filter(({ within }) => within.some(({ code }) => initial.includes(code)))
          .map(({ top }) => top.code),
      ),
  );
  const found = query.trim() === '' ? undefined : findTerritories(territories, query, locale);
  const others = chosen.filter((code) => !known.has(code));
  // The first box takes focus when the list is wrong (useFocusFirstInvalid).
  const firstCode = (found ? found[0]?.code : groups[0]?.top.code) ?? others[0];
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  const box = (code: string, words: string) => (
    <div key={code} className={styles.checkboxField}>
      <input
        id={`${id}-${code}`}
        className={styles.checkbox}
        type="checkbox"
        checked={chosen.includes(code)}
        aria-invalid={error && code === firstCode ? true : undefined}
        onChange={(event) => {
          const on = event.target.checked;
          // The hidden input holds the new codes before the form is told, so it reads them.
          flushSync(() =>
            setChosen((was) => (on ? [...was, code] : was.filter((c) => c !== code))),
          );
          onChange?.();
        }}
      />
      <label htmlFor={`${id}-${code}`}>{words}</label>
    </div>
  );

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
      <input type="hidden" name={name} value={chosen.join(', ')} />
      <p>
        {chosen.length > 0
          ? fill(text.chosen, {
              list: chosen
                .map((code) => {
                  const territory = known.get(code);
                  return territory ? shown(territory) : code;
                })
                .join(', '),
            })
          : text.noneChosen}
      </p>
      {territories.length >= FIND_FROM ? (
        <div className={styles.field}>
          <label htmlFor={`${id}-find`}>{text.find}</label>
          <span id={`${id}-find-hint`} className={styles.hint}>
            {text.findHint}
          </span>
          <input
            id={`${id}-find`}
            className={styles.input}
            type="search"
            value={query}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={`${id}-find-hint`}
            onChange={(event) => setQuery(event.target.value)}
            // Enter finds; it doesn't send the form.
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              if (event.key === 'Enter') {
                event.preventDefault();
              }
            }}
          />
        </div>
      ) : null}
      <div className={styles.territoryList}>
        {found ? (
          found.length > 0 ? (
            found.map((territory) => box(territory.code, shown(territory)))
          ) : (
            <p className={styles.hint}>{text.noMatch}</p>
          )
        ) : (
          groups.map(({ top, within }) => (
            <div key={top.code} className={styles.territoryList}>
              {box(top.code, shown(top))}
              {within.length > 0 ? (
                <details
                  className={styles.territoryWithin}
                  open={opened.has(top.code) || undefined}
                >
                  <summary className={styles.summary}>
                    {fill(text.within, { name: top.name, count: String(within.length) })}
                  </summary>
                  <div className={styles.territoryList}>
                    {within.map((territory) => box(territory.code, shown(territory)))}
                  </div>
                </details>
              ) : null}
            </div>
          ))
        )}
      </div>
      {others.length > 0 ? (
        <div className={styles.territoryList}>
          <p className={styles.label}>{text.other}</p>
          {others.map((code) => box(code, code))}
        </div>
      ) : null}
      {error ? (
        <p id={errorId} className={styles.fieldError}>
          <span aria-hidden="true">⚠</span>
          <span>{error}</span>
        </p>
      ) : null}
    </fieldset>
  );
};

/**
 * One territory, chosen from the site's country's subdivisions (PLAN R201), for an election: inside its form's
 * `Field`, which labels it. Its values are the codes after `prefix`, as the code field took them; an empty first
 * option says the whole country, or asks for one where one is needed. A code saved before that the list hasn't is
 * offered as it is.
 */
export const TerritorySelect = ({
  name,
  territories,
  prefix,
  initial,
  required,
  locale,
  text,
}: {
  name: string;
  territories: readonly Territory[];
  prefix: string;
  initial: string | null;
  required: boolean;
  locale: string;
  text: Pick<TerritoryPickerText, 'whole' | 'choose'>;
}) => {
  const option = (territory: Territory) => (
    <option key={territory.code} value={territory.code.slice(prefix.length)}>
      {shown(territory)}
    </option>
  );
  const unknown = initial !== null && !territories.some(({ code }) => code === initial);
  return (
    <FieldSelect
      className={styles.select}
      name={name}
      defaultValue={initial?.slice(prefix.length) ?? ''}
    >
      <option value="">{required ? text.choose : text.whole}</option>
      {unknown ? <option value={initial.slice(prefix.length)}>{initial}</option> : null}
      {territoryGroups(territories, locale).map(({ top, within }) =>
        within.length === 0 ? (
          option(top)
        ) : (
          <optgroup key={top.code} label={top.name}>
            {option(top)}
            {within.map(option)}
          </optgroup>
        ),
      )}
    </FieldSelect>
  );
};
