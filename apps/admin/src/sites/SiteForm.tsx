'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

import { announce } from '@/ui/announce';
import { FormMessages } from '@/ui/FormMessages';
import { formText, localizedFromForm } from '@/ui/forms';
import { type LocaleOption, LocalizedField } from '@/ui/LocalizedField';
import * as styles from '@/ui/styles';
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
  defaultLocale: string;
  enabledLocales: string;
  methodologyKind: string;
  methodologyKindHint: string;
  kinds: Record<'demands' | 'descriptive', string>;
  operator: string;
  operatorHint: string;
  chooseOperator: string;
  reportRetentionDays: string;
  create: string;
  created: string;
  errors: Record<WriteError, string>;
  /** Field-specific refusals, by the constraint that refused them. */
  constraints: Record<string, string>;
}

const ERROR_ID = 'site-error';

/** The constraint a field's refusal names, for its `aria-describedby`. */
const FIELD_CONSTRAINTS = {
  slug: ['slug_check', 'slug_length', 'tenants_slug_key', 'slug_reserved'],
  countryCode: ['tenants_country_code_check'],
  reportRetentionDays: ['tenants_report_retention_days_check', 'tenants_report_retention_days_max'],
} as const;

/**
 * A new site (PLAN R129): its short name, name, country, languages, methodology kind, operator and how long reports are
 * kept. It is created off; its own page turns it on and gives it addresses. The database checks every field and
 * decides who may (platform admins only).
 */
export const SiteForm = ({
  locales,
  organizations,
  text,
}: {
  /** The languages the platform has messages for. */
  locales: LocaleOption[];
  organizations: { id: string; name: string; lang: string }[];
  text: SiteFormText;
}) => {
  const router = useRouter();
  const { pending, error, status, statusLine, run } = useWrite();
  const [constraint, setConstraint] = useState<string>();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const defaultLocale = formText(form, 'defaultLocale');
    const enabledLocales = [
      ...new Set([defaultLocale, ...data.getAll('enabledLocales').map(String)]),
    ];
    // The name in the site's languages only: text typed in another is left out.
    const name = Object.fromEntries(
      Object.entries(localizedFromForm(form, 'name', locales)).filter(([code]) =>
        enabledLocales.includes(code),
      ),
    );
    const slug = formText(form, 'slug').trim();
    const body = {
      slug,
      name,
      countryCode: formText(form, 'countryCode'),
      defaultLocale,
      enabledLocales,
      methodologyKind: formText(form, 'methodologyKind'),
      operatorId: formText(form, 'operatorId'),
      reportRetentionDays: Number(formText(form, 'reportRetentionDays')),
    };
    setConstraint(undefined);
    const answer = await run(
      () => sendToApi('POST', '/api/sites', body),
      () => undefined,
    );
    if (answer && !answer.ok) {
      // Without a constraint, `incomplete` is the name (no text in the site's languages), and `taken` the one short
      // name the admin keeps for itself.
      setConstraint(
        answer.constraint ??
          (answer.error === 'incomplete'
            ? 'localized_check'
            : answer.error === 'taken'
              ? 'slug_reserved'
              : undefined),
      );
      return;
    }
    if (answer?.ok) {
      announce(text.created, { afterNavigation: true });
      router.replace(`/platform/sites/${encodeURIComponent(slug)}`);
    }
  };

  const refusedBy = (constraints: readonly string[]) =>
    constraint !== undefined && constraints.includes(constraint) ? ERROR_ID : undefined;
  const describedBy = (id: string, constraints: readonly string[] = []) =>
    [`${id}-hint`, refusedBy(constraints) ?? ''].filter(Boolean).join(' ');
  const message =
    error && constraint && text.constraints[constraint] ? text.constraints[constraint] : undefined;
  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="site-slug">
          {text.slug}
        </label>
        <p id="site-slug-hint" className={styles.hint}>
          {text.slugHint}
        </p>
        <input
          id="site-slug"
          className={styles.input}
          name="slug"
          required
          maxLength={63}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={refusedBy(FIELD_CONSTRAINTS.slug) ? true : undefined}
          aria-describedby={describedBy('site-slug', FIELD_CONSTRAINTS.slug)}
        />
      </div>
      <LocalizedField
        name="name"
        label={text.name}
        hint={text.nameHint}
        locales={locales}
        maxLength={200}
        requiredLabel={text.needed}
        describedBy={refusedBy(['localized_check'])}
      />
      <div className={styles.field}>
        <label className={styles.label} htmlFor="site-country">
          {text.countryCode}
        </label>
        <p id="site-country-hint" className={styles.hint}>
          {text.countryCodeHint}
        </p>
        <input
          id="site-country"
          className={styles.input}
          name="countryCode"
          required
          maxLength={2}
          pattern="[A-Za-z]{2}"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={refusedBy(FIELD_CONSTRAINTS.countryCode) ? true : undefined}
          aria-describedby={describedBy('site-country', FIELD_CONSTRAINTS.countryCode)}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="site-default-locale">
          {text.defaultLocale}
        </label>
        <select id="site-default-locale" className={styles.input} name="defaultLocale" required>
          {locales.map((locale) => (
            <option key={locale.code} value={locale.code}>
              {locale.label}
            </option>
          ))}
        </select>
      </div>
      <fieldset className={styles.fieldset}>
        <legend className={styles.label}>{text.enabledLocales}</legend>
        {locales.map((locale) => (
          <div key={locale.code} className={styles.checkboxField}>
            <input
              id={`site-locale-${locale.code}`}
              className={styles.checkbox}
              name="enabledLocales"
              type="checkbox"
              value={locale.code}
            />
            <label className={styles.label} htmlFor={`site-locale-${locale.code}`}>
              {locale.label}
            </label>
          </div>
        ))}
      </fieldset>
      <fieldset className={styles.fieldset} aria-describedby="site-kind-hint">
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
              required
            />
            <label className={styles.label} htmlFor={`site-kind-${kind}`}>
              {text.kinds[kind]}
            </label>
          </div>
        ))}
      </fieldset>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="site-operator">
          {text.operator}
        </label>
        <p id="site-operator-hint" className={styles.hint}>
          {text.operatorHint}
        </p>
        <select
          id="site-operator"
          className={styles.input}
          name="operatorId"
          required
          defaultValue=""
          aria-describedby="site-operator-hint"
        >
          <option value="" disabled>
            {text.chooseOperator}
          </option>
          {organizations.map((organization) => (
            <option key={organization.id} value={organization.id} lang={organization.lang}>
              {organization.name}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="site-retention">
          {text.reportRetentionDays}
        </label>
        <input
          id="site-retention"
          className={styles.input}
          name="reportRetentionDays"
          type="number"
          required
          min={1}
          max={36500}
          step={1}
          aria-invalid={refusedBy(FIELD_CONSTRAINTS.reportRetentionDays) ? true : undefined}
          aria-describedby={refusedBy(FIELD_CONSTRAINTS.reportRetentionDays)}
        />
      </div>
      <FormMessages
        id={ERROR_ID}
        statusRef={statusLine}
        error={error}
        status={message ? '' : status}
        errors={message && error ? { ...text.errors, [error]: message } : text.errors}
      />
      <div>
        <button className={styles.button} type="submit" aria-disabled={pending}>
          {text.create}
        </button>
      </div>
    </form>
  );
};
