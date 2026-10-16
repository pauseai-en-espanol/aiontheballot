'use client';

import { Fragment, type ReactNode, useId, useState } from 'react';

import type { WriteError } from '@/write';

import { ColourField, type ColourFieldText } from '@/ui/ColourField';
import { Field, FieldInput } from '@/ui/Field';
import { type LocaleOption, LocalizedField } from '@/ui/LocalizedField';
import { SlugField } from '@/ui/SlugField';
import * as styles from '@/ui/styles';
import { type Territory } from '@/ui/territory-tree';
import { TerritoryPicker, type TerritoryPickerText } from '@/ui/TerritoryPicker';

import type { FieldKind } from './fields';
import type { ProposalProblemText } from './problems';

import { isLocalized } from './fields';
import { MAX_LENGTH } from './form-values';

/** What the change forms say, shared by a new row's form and the edit of several fields (PLAN R183). */
export interface ChangeInputText extends ProposalProblemText {
  none: string;
  needed: string;
  optional: string;
  codesHint: string;
  /** Where the site's country has subdivisions to tick (PLAN R201). */
  codesPickHint: string;
  territoryPicker: TerritoryPickerText;
  /** A slug's hint, while it follows the name, and its public address (`{address}`). */
  slug: { hint: string; address: string };
  colour: ColourFieldText;
  /** Each field's label, by its column. */
  labels: Record<string, string>;
  /** Each source kind's label. */
  sourceKinds: Record<string, string>;
  errors: Record<WriteError, string>;
  constraints: Record<string, string>;
}

/** A value as the forms and the list show it: each language marked as such, source kinds by their names. */
export const ShownValue = ({
  value,
  text,
}: {
  value: unknown;
  text: Pick<ChangeInputText, 'none' | 'sourceKinds'>;
}): ReactNode => {
  if (value === null || value === undefined || value === '') {
    return text.none;
  }
  if (Array.isArray(value)) {
    return value.length > 0
      ? value
          .map((item) =>
            typeof item === 'string' ? (text.sourceKinds[item] ?? item) : JSON.stringify(item),
          )
          .join(', ')
      : text.none;
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([locale, item], index) => (
      <Fragment key={locale}>
        {index > 0 ? ' / ' : null}
        <span lang={locale}>{typeof item === 'string' ? item : JSON.stringify(item)}</span>
      </Fragment>
    ));
  }
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : JSON.stringify(value);
};

/** A colour field whose value travels in the form, as the other fields' do. */
const FormColour = ({
  name,
  label,
  initial,
  error,
  onChanged,
  text,
}: {
  name: string;
  label: string;
  initial: string | null;
  error?: string;
  onChanged?: () => void;
  text: ChangeInputText;
}) => {
  const [colour, setColour] = useState(initial);
  return (
    <>
      <ColourField
        label={label}
        optional={text.optional}
        value={colour}
        error={error}
        onChange={(value) => {
          setColour(value);
          // Once the hidden input below holds it, for a form that compares its values.
          requestAnimationFrame(() => onChanged?.());
        }}
        text={text.colour}
      />
      <input type="hidden" name={name} value={colour ?? ''} />
    </>
  );
};

/**
 * One field's input, named `value.{column}` in its form, starting from `initial`: localized text per language, source
 * kinds as boxes, a colour with no default, dates, numbers, codes (territories ticked where the site's country has
 * subdivisions to tick, PLAN R201) and plain text. Not a logo: its form holds that.
 * A new row's slug follows its name (`slug.from`) until edited, with the public address it makes (admin forms §1.5).
 * What is wrong with it, after a submit, shows under it (admin forms §1.2).
 */
export const ValueInput = ({
  name,
  kind,
  label,
  initial,
  locales,
  locale,
  sourceKinds,
  territories,
  error,
  onChanged,
  slug,
  text,
}: {
  name: string;
  kind: FieldKind;
  label: string;
  initial: unknown;
  locales: LocaleOption[];
  /** The page's language, which territories are sorted in. */
  locale: string;
  sourceKinds: readonly string[];
  /** The site's country's subdivisions, ticked for codes; none keeps the code field (PLAN R201). */
  territories: readonly Territory[];
  error?: string;
  /** For a slug: the name input it follows while new, and its public address with `{slug}` in place. */
  slug?: { from?: string | undefined; address?: string | undefined };
  /** Told when a value that sends no input event (a colour chosen or removed by a button) changes. */
  onChanged?: () => void;
  text: ChangeInputText;
}) => {
  const id = useId();
  const inputId = `${id}-${name}`;
  if (isLocalized(kind)) {
    return (
      <LocalizedField
        name={`value.${name}`}
        label={label}
        locales={locales}
        values={(initial as Record<string, string> | undefined) ?? {}}
        multiline={kind === 'localizedLong'}
        maxLength={MAX_LENGTH[name] ?? 300}
        requiredLabel={text.needed}
        error={error}
      />
    );
  }
  if (kind === 'sourceKinds') {
    const chosen = Array.isArray(initial) ? (initial as string[]) : [];
    const errorId = `${inputId}-error`;
    return (
      <fieldset className={styles.fieldset} aria-describedby={error ? errorId : undefined}>
        <legend className={styles.label}>{label}</legend>
        {sourceKinds.map((sourceKind, index) => (
          <div key={sourceKind} className={styles.checkboxField}>
            <input
              id={`${inputId}-${sourceKind}`}
              className={styles.checkbox}
              type="checkbox"
              name={`value.${name}`}
              value={sourceKind}
              defaultChecked={chosen.includes(sourceKind)}
              // The first box takes focus when the list is wrong (useFocusFirstInvalid).
              aria-invalid={error && index === 0 ? true : undefined}
            />
            <label htmlFor={`${inputId}-${sourceKind}`}>
              {text.sourceKinds[sourceKind] ?? sourceKind}
            </label>
          </div>
        ))}
        {error ? (
          <p id={errorId} className={styles.fieldError}>
            <span aria-hidden="true">⚠</span>
            <span>{error}</span>
          </p>
        ) : null}
      </fieldset>
    );
  }
  if (name === 'slug') {
    const saved = typeof initial === 'string' && initial !== '' ? initial : undefined;
    return (
      <SlugField
        name={`value.${name}`}
        from={saved === undefined ? slug?.from : undefined}
        value={saved}
        address={slug?.address}
        error={error}
        text={{
          label,
          hint: saved === undefined ? text.slug.hint : '',
          address: text.slug.address,
        }}
      />
    );
  }
  if (kind === 'codes' && territories.length > 0) {
    return (
      <TerritoryPicker
        name={`value.${name}`}
        label={label}
        hint={text.codesPickHint}
        error={error}
        territories={territories}
        initial={
          Array.isArray(initial)
            ? initial.filter((code): code is string => typeof code === 'string')
            : []
        }
        locale={locale}
        onChange={onChanged}
        text={text.territoryPicker}
      />
    );
  }
  if (kind === 'colour') {
    return (
      <FormColour
        name={`value.${name}`}
        label={label}
        initial={typeof initial === 'string' ? initial : null}
        error={error}
        onChanged={onChanged}
        text={text}
      />
    );
  }
  return (
    <Field
      label={label}
      hint={kind === 'codes' ? text.codesHint : undefined}
      // A reviewer's affiliation may be blank; a name or a slug may not.
      required={kind === 'text' && name !== 'affiliation'}
      error={error}
    >
      <FieldInput
        name={`value.${name}`}
        autoComplete="off"
        className={kind === 'number' ? styles.numberInput : styles.input}
        type={
          kind === 'date' ? 'date' : kind === 'number' ? 'number' : kind === 'url' ? 'url' : 'text'
        }
        inputMode={kind === 'number' ? 'numeric' : undefined}
        maxLength={MAX_LENGTH[name] ?? 300}
        spellCheck={kind === 'text' ? undefined : false}
        defaultValue={
          Array.isArray(initial)
            ? initial.join(', ')
            : typeof initial === 'string' || typeof initial === 'number'
              ? String(initial)
              : ''
        }
      />
    </Field>
  );
};
