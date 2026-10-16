'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

import type { ImageChoice } from '@/ui/image-field';

import { announce } from '@/ui/announce';
import {
  checkValues,
  constraintProblems,
  type FieldRule,
  type Problems,
  type ProblemText,
  refusalProblem,
} from '@/ui/checks';
import { Field, FieldInput } from '@/ui/Field';
import { FormActions } from '@/ui/FormActions';
import { FormMessages } from '@/ui/FormMessages';
import { formText, localizedFromForm } from '@/ui/forms';
import { ImageField, type ImageFieldText } from '@/ui/ImageField';
import { type LocaleOption, LocalizedField } from '@/ui/LocalizedField';
import * as styles from '@/ui/styles';
import { useProblems } from '@/ui/useProblems';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, uploadToApi, type WriteAnswer, type WriteError } from '@/write';

import { refusedField } from './refused-field';

export type OrganizationTextField =
  | 'legalName'
  | 'taxId'
  | 'address'
  | 'registryEntry'
  | 'contactEmail'
  | 'privacyEmail'
  | 'url'
  | 'newsletterUrl';

export interface OrganizationValues extends Readonly<
  Record<Exclude<OrganizationTextField, 'legalName'>, string | null>
> {
  id: string;
  displayName: Readonly<Record<string, string>>;
  legalName: string;
  isPauseaiChapter: boolean;
  /** Whether it has a logo, which the form shows from its own route (PLAN R195). */
  hasLogo: boolean;
}

export interface OrganizationFormText {
  displayName: string;
  displayNameHint: string;
  needed: string;
  fields: Record<OrganizationTextField, { label: string; hint?: string }>;
  optional: string;
  pauseai: string;
  pauseaiHint: string;
  logo: string;
  logoHint: string;
  /** With `{name}`. */
  logoAlt: string;
  image: ImageFieldText;
  /** The organization was saved and its logo wasn't: with `{error}`. */
  logoFailed: string;
  save: string;
  saved: string;
  errors: Record<WriteError, string>;
  problems: ProblemText;
  /** Field-specific refusals, by the constraint that refused them. */
  constraints: Record<string, string>;
}

/** A field of the form a problem can point at. */
type OrganizationField = 'displayName' | OrganizationTextField | 'isPauseaiChapter' | 'logo';

/**
 * The text fields, in the form's order: what each must be, checked before sending, and the constraint that checks it
 * again in the database, whose message the page gives (more specific than the shared one).
 */
const FIELDS: readonly {
  name: OrganizationTextField;
  type: 'text' | 'email' | 'url';
  maxLength: number;
  rule: FieldRule;
  constraint?: string;
}[] = [
  {
    name: 'legalName',
    type: 'text',
    maxLength: 300,
    rule: { required: true },
    constraint: 'legal_name',
  },
  { name: 'taxId', type: 'text', maxLength: 50, rule: {} },
  { name: 'address', type: 'text', maxLength: 500, rule: {} },
  { name: 'registryEntry', type: 'text', maxLength: 300, rule: {} },
  {
    name: 'contactEmail',
    type: 'email',
    maxLength: 254,
    rule: { shape: 'email' },
    constraint: 'organizations_contact_email_check',
  },
  {
    name: 'privacyEmail',
    type: 'email',
    maxLength: 254,
    rule: { shape: 'email' },
    constraint: 'organizations_privacy_email_check',
  },
  {
    name: 'url',
    type: 'url',
    maxLength: 2048,
    rule: { shape: 'https' },
    constraint: 'organizations_url_check',
  },
  {
    name: 'newsletterUrl',
    type: 'url',
    maxLength: 2048,
    rule: { shape: 'https' },
    constraint: 'organizations_newsletter_url_check',
  },
];

/** The field each constraint the database names is about (`refusedField`'s names included). */
const CONSTRAINT_FIELDS: Readonly<Record<string, OrganizationField>> = {
  localized_check: 'displayName',
  pauseai: 'isPauseaiChapter',
  ...Object.fromEntries(
    FIELDS.flatMap(({ name, constraint }) => (constraint ? [[constraint, name]] : [])),
  ),
};

/** The request's fields, as the form names them: the same names. */
const BODY_FIELDS: readonly OrganizationField[] = [
  'displayName',
  ...FIELDS.map(({ name }) => name),
  'isPauseaiChapter',
];

const ERROR_ID = 'organization-error';

/**
 * An organization's fields (editorial workflow P2.1): what the public sees on the sites it serves, the legal notice
 * included, and its logo (PLAN R195), previewed before anything is sent and uploaded once the organization is saved, so
 * a new one gets it in the same step. A new one is created; an existing one is changed in place, every field at once.
 * The database checks the emails and links (P2.2) and decides who may write (platform admins only). What is wrong
 * shows at its field, in words, and the first takes focus (admin forms §1.2).
 */
export const OrganizationForm = ({
  locales,
  locale,
  organization,
  text,
}: {
  locales: LocaleOption[];
  /** The admin's language, for the logo's size. */
  locale: string;
  /** The organization being changed; none when creating one. */
  organization?: OrganizationValues;
  text: OrganizationFormText;
}) => {
  const router = useRouter();
  const { pending, error, status, statusLine, run, setError } = useWrite();
  const { problems, show, form: formRef } = useProblems<OrganizationField>();
  const [logo, setLogo] = useState<ImageChoice>({ kind: 'keep' });

  /** The logo's upload or removal, once the organization exists. */
  const saveLogo = (id: string): Promise<WriteAnswer> => {
    const path = `/api/organizations/${encodeURIComponent(id)}/logo`;
    return logo.kind === 'new'
      ? uploadToApi(path, logo.file)
      : logo.kind === 'remove'
        ? sendToApi('DELETE', path)
        : Promise.resolve({ ok: true });
  };

  /** What the form can tell before sending: each field's problem, in the page's words for its constraint if any. */
  const check = (form: HTMLFormElement): Problems<OrganizationField> => {
    const found: Problems<OrganizationField> = checkValues(
      Object.fromEntries(FIELDS.map(({ name }) => [name, formText(form, name).trim()])) as Record<
        OrganizationTextField,
        string
      >,
      Object.fromEntries(FIELDS.map(({ name, rule }) => [name, rule])) as Record<
        OrganizationTextField,
        FieldRule
      >,
      text.problems,
    );
    for (const { name, constraint } of FIELDS) {
      const message = constraint === undefined ? undefined : text.constraints[constraint];
      if (found[name] !== undefined && message !== undefined) {
        found[name] = message;
      }
    }
    if (
      Object.values(localizedFromForm(form, 'displayName', locales)).every(
        (value) => value.trim() === '',
      )
    ) {
      found.displayName = text.constraints.localized_check ?? text.problems.localized;
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
    const pauseai = form.elements.namedItem('isPauseaiChapter');
    const body = {
      displayName: localizedFromForm(form, 'displayName', locales),
      ...(Object.fromEntries(FIELDS.map(({ name }) => [name, formText(form, name)])) as Record<
        OrganizationTextField,
        string
      >),
      isPauseaiChapter: pauseai instanceof HTMLInputElement && pauseai.checked,
    };
    // A new one's own page says it was saved; the form's status line would go with this page.
    let logoRefused: WriteError | undefined;
    const answer = await run(
      async () => {
        const saved = organization
          ? await sendToApi(
              'PUT',
              `/api/organizations/${encodeURIComponent(organization.id)}`,
              body,
            )
          : await sendToApi('POST', '/api/organizations', body);
        const id = organization?.id ?? (saved.body as { id?: unknown } | undefined)?.id;
        if (saved.ok && typeof id === 'string') {
          const stored = await saveLogo(id);
          if (!stored.ok) {
            logoRefused = stored.error ?? 'unexpected';
          }
        }
        // Only the logo's refusal, if any, is left to say: at the field when editing, on the new one's page otherwise.
        return saved.ok && logoRefused && organization ? { ok: false, error: logoRefused } : saved;
      },
      organization ? text.saved : () => undefined,
    );
    if (answer && !answer.ok && logoRefused && organization) {
      setError(undefined);
      show({ logo: text.errors[logoRefused] });
      return;
    }
    if (answer && !answer.ok) {
      // A refusal with no constraint is about the field `refusedField` finds in what was sent.
      const constraint =
        answer.constraint ?? (answer.error === 'incomplete' ? refusedField(body) : undefined);
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
    const created = (answer?.body as { id?: unknown } | undefined)?.id;
    if (answer?.ok && !organization && typeof created === 'string') {
      announce(
        logoRefused ? text.logoFailed.replace('{error}', text.errors[logoRefused]) : text.saved,
        { afterNavigation: true },
      );
      router.replace(`/platform/organizations/${created}`);
      return;
    }
    if (answer?.ok) {
      setLogo({ kind: 'keep' });
    }
  };

  const pauseaiProblem = problems.isPauseaiChapter;
  return (
    <form ref={formRef} className={styles.form} onSubmit={submit} noValidate>
      <LocalizedField
        name="displayName"
        label={text.displayName}
        hint={text.displayNameHint}
        locales={locales}
        values={organization?.displayName}
        maxLength={200}
        requiredLabel={text.needed}
        error={problems.displayName}
      />
      {FIELDS.map((field) => {
        const { label, hint } = text.fields[field.name];
        return (
          <Field
            key={field.name}
            label={label}
            hint={hint}
            optional={field.rule.required ? undefined : text.optional}
            error={problems[field.name]}
            required={field.rule.required}
          >
            <FieldInput
              className={styles.input}
              name={field.name}
              type={field.type === 'url' ? 'url' : 'text'}
              inputMode={field.type === 'email' ? 'email' : undefined}
              maxLength={field.maxLength}
              autoComplete="off"
              spellCheck={field.type === 'text' ? undefined : false}
              defaultValue={organization?.[field.name] ?? ''}
            />
          </Field>
        );
      })}
      <div className={styles.checkboxField}>
        <input
          id="organization-pauseai"
          className={styles.checkbox}
          name="isPauseaiChapter"
          type="checkbox"
          defaultChecked={organization?.isPauseaiChapter ?? false}
          aria-invalid={pauseaiProblem ? true : undefined}
          aria-describedby={[
            'organization-pauseai-hint',
            pauseaiProblem ? 'organization-pauseai-error' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        />
        <label className={styles.label} htmlFor="organization-pauseai">
          {text.pauseai}
        </label>
      </div>
      <p id="organization-pauseai-hint" className={styles.hint}>
        {text.pauseaiHint}
      </p>
      {pauseaiProblem ? (
        <p id="organization-pauseai-error" className={styles.fieldError}>
          <span aria-hidden="true">⚠</span>
          <span>{pauseaiProblem}</span>
        </p>
      ) : null}
      <ImageField
        label={text.logo}
        hint={text.logoHint}
        optional={text.optional}
        current={
          organization?.hasLogo
            ? `/api/organizations/${encodeURIComponent(organization.id)}/logo`
            : null
        }
        alt={text.logoAlt.replace('{name}', organization?.legalName ?? text.logo)}
        value={logo}
        onChange={(choice) => {
          setLogo(choice);
          show({});
        }}
        error={problems.logo}
        locale={locale}
        text={text.image}
      />
      <FormMessages id={ERROR_ID} error={error} errors={text.errors} />
      <FormActions label={text.save} pending={pending} status={status} statusRef={statusLine} />
    </form>
  );
};
