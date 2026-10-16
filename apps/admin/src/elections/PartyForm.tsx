'use client';

import { useRouter } from 'next/navigation';
import { type ComponentProps, type FormEvent, useState } from 'react';

import type { ImageChoice } from '@/ui/image-field';

import { announce } from '@/ui/announce';
import { COLOUR } from '@/ui/colour';
import { ColourField, type ColourFieldText } from '@/ui/ColourField';
import { Field, FieldInput } from '@/ui/Field';
import { useFocusFirstInvalid } from '@/ui/focus';
import { FormActions } from '@/ui/FormActions';
import { FormMessages } from '@/ui/FormMessages';
import { formText, localizedFromForm } from '@/ui/forms';
import { ImageField, type ImageFieldText } from '@/ui/ImageField';
import { type LocaleOption, LocalizedField } from '@/ui/LocalizedField';
import { SlugField } from '@/ui/SlugField';
import * as styles from '@/ui/styles';
import { type Territory } from '@/ui/territory-tree';
import { TerritoryPicker, type TerritoryPickerText } from '@/ui/TerritoryPicker';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, uploadToApi, type WriteAnswer, type WriteError } from '@/write';

/** A field of the party form a refusal can point at. */
export type PartyField =
  'name' | 'shortName' | 'slug' | 'logo' | 'colour' | 'website' | 'territories';

/** What the form says is wrong with a field, before sending or from the API's refusal. */
export type PartyProblem =
  | 'nameMissing'
  | 'shortNameMissing'
  | 'slugMissing'
  | 'slugInvalid'
  | 'slugTaken'
  | 'colourInvalid'
  | 'websiteInvalid'
  | 'territoriesInvalid'
  | 'nameNeeded';

export interface PartyFormText {
  name: string;
  shortName: string;
  shortNameHint: string;
  needed: string;
  optional: string;
  slug: ComponentProps<typeof SlugField>['text'];
  logo: string;
  logoHint: string;
  /** With `{name}`. */
  logoAlt: string;
  image: ImageFieldText;
  colour: string;
  colourHint: string;
  colourField: ColourFieldText;
  website: string;
  websiteHint: string;
  territories: string;
  territoriesHint: string;
  /** The picker's hint, where the site's country has subdivisions to tick (PLAN R201). */
  territoriesPickHint: string;
  territoryPicker: TerritoryPickerText;
  add: string;
  save: string;
  saved: string;
  added: string;
  /** The party was saved and its logo wasn't: with `{error}`. */
  logoFailed: string;
  problems: Record<PartyProblem, string>;
  errors: Record<WriteError, string>;
}

const ERROR_ID = 'party-error';
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const WEBSITE = /^https?:\/\/\S+$/u;
const TERRITORY = /^[A-Z]{2}-[A-Z\d]{1,3}$/u;

/** Which field a constraint the API names is about, and what to say there. */
const CONSTRAINTS: Readonly<Record<string, [PartyField, PartyProblem]>> = {
  slug_check: ['slug', 'slugInvalid'],
  slug_length: ['slug', 'slugInvalid'],
  parties_election_id_slug_key: ['slug', 'slugTaken'],
  parties_colour_check: ['colour', 'colourInvalid'],
  parties_website_check: ['website', 'websiteInvalid'],
  parties_territory_codes_check: ['territories', 'territoriesInvalid'],
  localized_check: ['name', 'nameNeeded'],
};

/**
 * A party of a draft election, or one in preview (editorial workflow E4.1; admin forms §2): its names per language, the
 * name in its address, its logo, colour, website and the territories it stands in, if not everywhere. The logo is
 * chosen here, previewed before anything is sent, and uploaded once the party is saved, so a new party gets one in the
 * same step. A party's colour is never used for a rating, and a new one has none until someone picks one. The form
 * says what is wrong at each field, in words, and moves focus to the first; the API and the database check it all
 * again. Its slug follows the name until edited and shows the public address it makes (admin forms §1.5). Editing
 * stays on the page; adding goes back to the list and says so there.
 */
export const PartyForm = ({
  path,
  method,
  partiesPath,
  pagesPath,
  values,
  countryCode,
  territories,
  locales,
  locale,
  slugAddress,
  text,
}: {
  /** The party's route in the API (PUT), or its election's parties' (POST). */
  path: string;
  method: 'POST' | 'PUT';
  /** The election's parties in the API, for a new party's logo. */
  partiesPath: string;
  /** The election's parties in the admin: the list, and each party's page under it. */
  pagesPath: string;
  values?: {
    slug: string;
    name: Readonly<Record<string, string>>;
    shortName: Readonly<Record<string, string>>;
    colour: string | null;
    website: string | null;
    territoryCodes: string[] | null;
    /** Its logo as members see it, and whose it is, for its alternative text. */
    logo: string | null;
    displayName: string;
  };
  countryCode: string;
  /** The country's subdivisions to tick; none keeps the code field (PLAN R201). */
  territories: readonly Territory[];
  locales: LocaleOption[];
  locale: string;
  /** Its public path, with `{slug}` where the slug goes. */
  slugAddress: string;
  text: PartyFormText;
}) => {
  const router = useRouter();
  const { pending, error, status, statusLine, run, setError } = useWrite();
  const [problems, setProblems] = useState<Partial<Record<PartyField, string>>>({});
  const [logo, setLogo] = useState<ImageChoice>({ kind: 'keep' });
  const [colour, setColour] = useState<string | null>(values?.colour ?? null);
  const { form: formRef, focusFirstInvalid } = useFocusFirstInvalid();
  const creating = method === 'POST';
  const problem = (key: PartyProblem) => text.problems[key].replace('{country}', countryCode);

  /** What the form can tell before sending: each field's problem, if any. */
  const check = (form: HTMLFormElement, territories: string[]) => {
    const found: Partial<Record<PartyField, string>> = {};
    const filled = (name: string) =>
      Object.values(localizedFromForm(form, name, locales)).some((v) => v.trim() !== '');
    if (!filled('name')) {
      found.name = text.problems.nameMissing;
    }
    if (!filled('shortName')) {
      found.shortName = text.problems.shortNameMissing;
    }
    const slug = formText(form, 'slug').trim();
    if (slug === '') {
      found.slug = text.problems.slugMissing;
    } else if (!SLUG.test(slug) || slug.length > 63) {
      found.slug = text.problems.slugInvalid;
    }
    if (colour !== null && !COLOUR.test(colour)) {
      found.colour = text.problems.colourInvalid;
    }
    const website = formText(form, 'website').trim();
    if (website !== '' && !WEBSITE.test(website)) {
      found.website = text.problems.websiteInvalid;
    }
    if (territories.some((code) => !TERRITORY.test(code) || !code.startsWith(`${countryCode}-`))) {
      found.territories = problem('territoriesInvalid');
    }
    return found;
  };

  /** The logo's upload or removal, once the party exists; a refusal is marked as the logo's. */
  const saveLogo = async (partyPath: string): Promise<WriteAnswer> => {
    if (logo.kind === 'new') {
      return uploadToApi(`${partyPath}/logo`, logo.file);
    }
    if (logo.kind === 'remove') {
      return sendToApi('DELETE', `${partyPath}/logo`);
    }
    return { ok: true };
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const territories = formText(form, 'territories')
      .split(/[\s,]+/u)
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean);
    const found = check(form, territories);
    setProblems(found);
    if (Object.keys(found).length > 0) {
      setError(undefined);
      focusFirstInvalid();
      return;
    }
    let created: string | undefined;
    let logoRefused: WriteError | undefined;
    const answer = await run(
      async () => {
        const saved = await sendToApi(method, path, {
          slug: formText(form, 'slug').trim(),
          name: localizedFromForm(form, 'name', locales),
          shortName: localizedFromForm(form, 'shortName', locales),
          colour,
          website: formText(form, 'website').trim() || null,
          territoryCodes: territories.length > 0 ? territories : null,
        });
        if (!saved.ok) {
          return saved;
        }
        created = creating ? (saved.body as { id?: string } | undefined)?.id : undefined;
        const partyPath = creating ? (created ? `${partiesPath}/${created}` : undefined) : path;
        const logoSaved = partyPath ? await saveLogo(partyPath) : { ok: true };
        if (!logoSaved.ok) {
          logoRefused = logoSaved.error ?? 'unexpected';
          // The party is saved: only the logo's refusal is left to say.
          return creating ? { ok: true } : { ...logoSaved, constraint: 'logo' };
        }
        return saved;
      },
      creating ? () => undefined : text.saved,
    );
    if (answer && !answer.ok) {
      if (answer.constraint === 'logo' && logoRefused) {
        setError(undefined);
        setProblems({ logo: text.errors[logoRefused] });
        focusFirstInvalid();
        return;
      }
      const pointed = answer.constraint ? CONSTRAINTS[answer.constraint] : undefined;
      if (pointed) {
        setError(undefined);
        setProblems({ [pointed[0]]: problem(pointed[1]) });
        focusFirstInvalid();
      }
      return;
    }
    if (!answer?.ok) {
      return;
    }
    if (creating) {
      if (logoRefused && created) {
        // Saved without its logo: its own page, where the logo can be chosen again.
        announce(text.logoFailed.replace('{error}', text.errors[logoRefused]), {
          afterNavigation: true,
        });
        router.push(`${pagesPath}/${created}`);
        return;
      }
      announce(text.added, { afterNavigation: true });
      router.push(pagesPath);
      return;
    }
    setLogo({ kind: 'keep' });
  };

  return (
    <form ref={formRef} className={styles.form} onSubmit={submit} noValidate>
      <LocalizedField
        name="name"
        label={text.name}
        locales={locales}
        values={values?.name}
        maxLength={200}
        requiredLabel={text.needed}
        error={problems.name}
      />
      <LocalizedField
        name="shortName"
        label={text.shortName}
        hint={text.shortNameHint}
        locales={locales}
        values={values?.shortName}
        maxLength={60}
        requiredLabel={text.needed}
        error={problems.shortName}
      />
      <SlugField
        from={values ? undefined : `name.${locales[0]?.code ?? ''}`}
        value={values?.slug}
        address={slugAddress}
        error={problems.slug}
        text={text.slug}
      />
      <ImageField
        label={text.logo}
        hint={text.logoHint}
        optional={text.optional}
        current={values?.logo ?? null}
        alt={values ? text.logoAlt.replace('{name}', values.displayName) : text.logo}
        value={logo}
        onChange={(choice) => {
          setLogo(choice);
          setProblems(({ logo: _, ...rest }) => rest);
        }}
        error={problems.logo}
        locale={locale}
        text={text.image}
      />
      <ColourField
        label={text.colour}
        hint={text.colourHint}
        optional={text.optional}
        value={colour}
        onChange={setColour}
        error={problems.colour}
        text={text.colourField}
      />
      <Field
        label={text.website}
        hint={text.websiteHint}
        optional={text.optional}
        error={problems.website}
      >
        <FieldInput
          className={styles.input}
          name="website"
          type="url"
          maxLength={500}
          placeholder="https://"
          autoComplete="off"
          defaultValue={values?.website ?? ''}
        />
      </Field>
      {territories.length > 0 ? (
        <TerritoryPicker
          name="territories"
          label={text.territories}
          hint={text.territoriesPickHint}
          optional={text.optional}
          error={problems.territories}
          territories={territories}
          initial={values?.territoryCodes ?? []}
          locale={locale}
          text={text.territoryPicker}
        />
      ) : (
        <Field
          label={text.territories}
          hint={text.territoriesHint.replace('{country}', countryCode)}
          optional={text.optional}
          error={problems.territories}
        >
          <FieldInput
            className={styles.input}
            name="territories"
            maxLength={600}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            defaultValue={values?.territoryCodes?.join(', ') ?? ''}
          />
        </Field>
      )}
      <FormMessages id={ERROR_ID} error={error} errors={text.errors} />
      <FormActions
        label={creating ? text.add : text.save}
        pending={pending}
        status={status}
        statusRef={statusLine}
      />
    </form>
  );
};
