'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useMemo } from 'react';

import { announce } from '@/ui/announce';
import {
  checkValues,
  constraintProblems,
  type Problems,
  type ProblemText,
  refusalProblem,
} from '@/ui/checks';
import { COUNTRY_CODES, DEMO_CODES } from '@/ui/countries';
import { Field, FieldInput, FieldSelect } from '@/ui/Field';
import { FormActions } from '@/ui/FormActions';
import { FormMessages } from '@/ui/FormMessages';
import { formText, localizedFromForm } from '@/ui/forms';
import { type LocaleOption, LocalizedField } from '@/ui/LocalizedField';
import { SlugField } from '@/ui/SlugField';
import * as styles from '@/ui/styles';
import { useProblems } from '@/ui/useProblems';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

export interface SiteFormText {
  slug: string;
  slugHint: string;
  name: string;
  nameHint: string;
  needed: string;
  countryCode: string;
  countryCodeHint: string;
  chooseCountry: string;
  /** The group of codes no country has, for demonstration sites. */
  demoCountries: string;
  defaultLocale: string;
  enabledLocales: string;
  methodologyKind: string;
  methodologyKindHint: string;
  kinds: Record<'demands' | 'descriptive', string>;
  operator: string;
  operatorHint: string;
  chooseOperator: string;
  reportRetentionDays: string;
  optional: string;
  create: string;
  created: string;
  errors: Record<WriteError, string>;
  problems: ProblemText;
  /** Field-specific refusals, by the constraint that refused them. */
  constraints: Record<string, string>;
}

/** A field of the form a problem can point at, by the request's name for it. */
type SiteField =
  | 'slug'
  | 'name'
  | 'countryCode'
  | 'defaultLocale'
  | 'enabledLocales'
  | 'methodologyKind'
  | 'operatorId'
  | 'reportRetentionDays';

const ERROR_ID = 'site-error';

/** The field each constraint the database names is about. */
const CONSTRAINT_FIELDS: Readonly<Record<string, SiteField>> = {
  slug_check: 'slug',
  slug_length: 'slug',
  tenants_slug_key: 'slug',
  slug_reserved: 'slug',
  localized_check: 'name',
  tenants_country_code_check: 'countryCode',
  tenants_report_retention_days_check: 'reportRetentionDays',
  tenants_report_retention_days_max: 'reportRetentionDays',
};

/** The request's fields: the form's own names. */
const BODY_FIELDS: readonly SiteField[] = [
  'slug',
  'name',
  'countryCode',
  'defaultLocale',
  'enabledLocales',
  'methodologyKind',
  'operatorId',
  'reportRetentionDays',
];

/** A problem of a group of checkboxes or radios, under the group, in words and a sign. */
const GroupProblem = ({ id, problem }: { id: string; problem: string | undefined }) =>
  problem ? (
    <p id={id} className={styles.fieldError}>
      <span aria-hidden="true">⚠</span>
      <span>{problem}</span>
    </p>
  ) : null;

/**
 * A new site (PLAN R129): its name, the name in its addresses (which follows the name in the first language until
 * edited, admin forms §1.5), country, languages, methodology kind, operator and how long reports are kept. It is
 * created off; its own page turns it on and shows its addresses. The database checks every field and decides who may
 * (platform admins only). What is wrong shows at its field, in words, and the first takes focus (admin forms §1.2).
 */
export const SiteForm = ({
  uiLocale,
  locales,
  organizations,
  text,
}: {
  /** The admin's language, which countries are named in. */
  uiLocale: string;
  /** The languages the platform has messages for. */
  locales: LocaleOption[];
  organizations: { id: string; name: string; lang: string }[];
  text: SiteFormText;
}) => {
  const router = useRouter();
  const countries = useMemo(() => {
    const names = new Intl.DisplayNames([uiLocale], { type: 'region' });
    return COUNTRY_CODES.map((code) => ({ code, name: names.of(code) ?? code })).sort((a, b) =>
      a.name.localeCompare(b.name, uiLocale),
    );
  }, [uiLocale]);
  const { pending, error, run, setError } = useWrite();
  const { problems, show, form: formRef } = useProblems<SiteField>();

  /** The site's languages: its default one first, then those ticked. */
  const siteLocales = (form: HTMLFormElement) => [
    ...new Set([
      formText(form, 'defaultLocale'),
      ...new FormData(form).getAll('enabledLocales').map(String),
    ]),
  ];

  /** The name in the site's languages only: text typed in another is left out. */
  const siteName = (form: HTMLFormElement, enabled: readonly string[]) =>
    Object.fromEntries(
      Object.entries(localizedFromForm(form, 'name', locales)).filter(([code]) =>
        enabled.includes(code),
      ),
    );

  /** What the form can tell before sending, in the page's words for the constraint where there is one. */
  const check = (form: HTMLFormElement): Problems<SiteField> => {
    const found: Problems<SiteField> = checkValues(
      {
        slug: formText(form, 'slug').trim(),
        countryCode: formText(form, 'countryCode').trim(),
        methodologyKind: formText(form, 'methodologyKind'),
        operatorId: formText(form, 'operatorId'),
        reportRetentionDays: formText(form, 'reportRetentionDays').trim(),
      },
      {
        slug: { required: true, shape: 'slug' },
        countryCode: { required: true },
        methodologyKind: { required: true },
        operatorId: { required: true },
        reportRetentionDays: { required: true, whole: { min: 1, max: 36_500 } },
      },
      text.problems,
    );
    const slug = formText(form, 'slug').trim();
    if (slug !== '' && found.slug !== undefined) {
      found.slug = text.constraints.slug_check ?? found.slug;
    }
    const country = formText(form, 'countryCode').trim();
    if (country !== '' && !/^[A-Za-z]{2}$/u.test(country)) {
      found.countryCode = text.constraints.tenants_country_code_check ?? text.problems.invalid;
    }
    if (formText(form, 'reportRetentionDays').trim() !== '' && found.reportRetentionDays) {
      found.reportRetentionDays =
        text.constraints.tenants_report_retention_days_check ?? found.reportRetentionDays;
    }
    // A choice nobody made says so, rather than "fill this in".
    for (const choice of ['methodologyKind', 'operatorId'] as const) {
      if (found[choice] !== undefined) {
        found[choice] = text.problems.choose;
      }
    }
    if (Object.values(siteName(form, siteLocales(form))).every((value) => value.trim() === '')) {
      found.name = text.constraints.localized_check ?? text.problems.localized;
    }
    return found;
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (show(check(form))) {
      setError(undefined);
      return;
    }
    const enabledLocales = siteLocales(form);
    const slug = formText(form, 'slug').trim();
    const body = {
      slug,
      name: siteName(form, enabledLocales),
      countryCode: formText(form, 'countryCode'),
      defaultLocale: formText(form, 'defaultLocale'),
      enabledLocales,
      methodologyKind: formText(form, 'methodologyKind'),
      operatorId: formText(form, 'operatorId'),
      reportRetentionDays: Number(formText(form, 'reportRetentionDays')),
    };
    const answer = await run(
      () => sendToApi('POST', '/api/sites', body),
      () => undefined,
    );
    if (answer && !answer.ok) {
      // Without a constraint, `incomplete` is the name (no text in the site's languages), and `taken` the one short
      // name the admin keeps for itself.
      const constraint =
        answer.constraint ??
        (answer.error === 'incomplete'
          ? 'localized_check'
          : answer.error === 'taken'
            ? 'slug_reserved'
            : undefined);
      const pointed = refusalProblem(
        { ...answer, ...(constraint === undefined ? {} : { constraint }) },
        constraintProblems(CONSTRAINT_FIELDS, text.constraints, text.problems.invalid),
        Object.fromEntries(BODY_FIELDS.map((field) => [field, [field, text.problems.invalid]])),
      );
      if (pointed && show(pointed)) {
        setError(undefined);
      }
      return;
    }
    if (answer?.ok) {
      announce(text.created, { afterNavigation: true });
      router.replace(`/platform/sites/${encodeURIComponent(slug)}`);
    }
  };

  return (
    <form ref={formRef} className={styles.form} onSubmit={submit} noValidate>
      <LocalizedField
        name="name"
        label={text.name}
        hint={text.nameHint}
        locales={locales}
        maxLength={200}
        requiredLabel={text.needed}
        error={problems.name}
      />
      {/* A site's slug names it in the admin's and the platform's addresses only: no public address to show. */}
      <SlugField
        from={locales[0] ? `name.${locales[0].code}` : undefined}
        error={problems.slug}
        text={{ label: text.slug, hint: text.slugHint, address: '' }}
      />
      <Field
        label={text.countryCode}
        hint={text.countryCodeHint}
        error={problems.countryCode}
        required
      >
        {/* By its name, in the admin's language (admin forms §1.6, PLAN R196); a demo site's codes apart. */}
        <FieldSelect className={styles.select} name="countryCode" defaultValue="">
          <option value="" disabled>
            {text.chooseCountry}
          </option>
          {countries.map((country) => (
            <option key={country.code} value={country.code}>
              {country.name}
            </option>
          ))}
          <optgroup label={text.demoCountries}>
            {DEMO_CODES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </optgroup>
        </FieldSelect>
      </Field>
      <Field label={text.defaultLocale} error={problems.defaultLocale} required>
        <FieldSelect className={styles.input} name="defaultLocale">
          {locales.map((locale) => (
            <option key={locale.code} value={locale.code}>
              {locale.label}
            </option>
          ))}
        </FieldSelect>
      </Field>
      <fieldset className={styles.fieldset}>
        <legend className={styles.label}>
          {text.enabledLocales}
          <span className={styles.optional}> ({text.optional})</span>
        </legend>
        {locales.map((locale, index) => (
          <div key={locale.code} className={styles.checkboxField}>
            <input
              id={`site-locale-${locale.code}`}
              className={styles.checkbox}
              name="enabledLocales"
              type="checkbox"
              value={locale.code}
              aria-invalid={index === 0 && problems.enabledLocales ? true : undefined}
              aria-describedby={
                index === 0 && problems.enabledLocales ? 'site-locales-error' : undefined
              }
            />
            <label className={styles.label} htmlFor={`site-locale-${locale.code}`}>
              {locale.label}
            </label>
          </div>
        ))}
        <GroupProblem id="site-locales-error" problem={problems.enabledLocales} />
      </fieldset>
      {/* The group is what is marked, and takes focus, when no kind was chosen: a radio can't be invalid itself. */}
      <fieldset
        className={styles.fieldset}
        role="radiogroup"
        tabIndex={-1}
        aria-invalid={problems.methodologyKind ? true : undefined}
        aria-describedby={['site-kind-hint', problems.methodologyKind ? 'site-kind-error' : '']
          .filter(Boolean)
          .join(' ')}
      >
        <legend className={styles.label}>{text.methodologyKind}</legend>
        <p id="site-kind-hint" className={styles.hint}>
          {text.methodologyKindHint}
        </p>
        {(['demands', 'descriptive'] as const).map((kind) => (
          <div key={kind} className={styles.checkboxField}>
            <input
              id={`site-kind-${kind}`}
              className={styles.checkbox}
              name="methodologyKind"
              type="radio"
              value={kind}
            />
            <label className={styles.label} htmlFor={`site-kind-${kind}`}>
              {text.kinds[kind]}
            </label>
          </div>
        ))}
        <GroupProblem id="site-kind-error" problem={problems.methodologyKind} />
      </fieldset>
      <Field label={text.operator} hint={text.operatorHint} error={problems.operatorId} required>
        <FieldSelect className={styles.input} name="operatorId" defaultValue="">
          <option value="" disabled>
            {text.chooseOperator}
          </option>
          {organizations.map((organization) => (
            <option key={organization.id} value={organization.id} lang={organization.lang}>
              {organization.name}
            </option>
          ))}
        </FieldSelect>
      </Field>
      <Field label={text.reportRetentionDays} error={problems.reportRetentionDays} required>
        <FieldInput
          className={styles.input}
          name="reportRetentionDays"
          type="number"
          inputMode="numeric"
          step={1}
        />
      </Field>
      <FormMessages id={ERROR_ID} error={error} errors={text.errors} />
      {/* A new site's own page says it was created: no status line here. */}
      <FormActions label={text.create} pending={pending} />
    </form>
  );
};
