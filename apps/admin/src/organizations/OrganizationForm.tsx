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
}

export interface OrganizationFormText {
  displayName: string;
  displayNameHint: string;
  needed: string;
  fields: Record<OrganizationTextField, { label: string; hint?: string }>;
  optional: string;
  pauseai: string;
  pauseaiHint: string;
  save: string;
  saved: string;
  errors: Record<WriteError, string>;
  /** Field-specific refusals, by the constraint that refused them. */
  constraints: Record<string, string>;
}

/** The text fields, in the form's order, with the constraint that checks each in the database. */
const FIELDS: readonly {
  name: OrganizationTextField;
  type: 'text' | 'email' | 'url';
  maxLength: number;
  required?: boolean;
  constraint?: string;
}[] = [
  { name: 'legalName', type: 'text', maxLength: 300, required: true, constraint: 'legal_name' },
  { name: 'taxId', type: 'text', maxLength: 50 },
  { name: 'address', type: 'text', maxLength: 500 },
  { name: 'registryEntry', type: 'text', maxLength: 300 },
  {
    name: 'contactEmail',
    type: 'email',
    maxLength: 254,
    constraint: 'organizations_contact_email_check',
  },
  {
    name: 'privacyEmail',
    type: 'email',
    maxLength: 254,
    constraint: 'organizations_privacy_email_check',
  },
  { name: 'url', type: 'url', maxLength: 2048, constraint: 'organizations_url_check' },
  {
    name: 'newsletterUrl',
    type: 'url',
    maxLength: 2048,
    constraint: 'organizations_newsletter_url_check',
  },
];

const ERROR_ID = 'organization-error';

/**
 * An organization's fields (editorial workflow P2.1), but its logo, which needs uploads: what the public sees on the
 * sites it serves, the legal notice included. A new one is created; an existing one is changed in place, every field
 * at once. The database checks the emails and links (P2.2) and decides who may write (platform admins only).
 */
export const OrganizationForm = ({
  locales,
  organization,
  text,
}: {
  locales: LocaleOption[];
  /** The organization being changed; none when creating one. */
  organization?: OrganizationValues;
  text: OrganizationFormText;
}) => {
  const router = useRouter();
  const { pending, error, status, statusLine, run } = useWrite();
  const [constraint, setConstraint] = useState<string>();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const pauseai = form.elements.namedItem('isPauseaiChapter');
    const body = {
      displayName: localizedFromForm(form, 'displayName', locales),
      ...(Object.fromEntries(FIELDS.map(({ name }) => [name, formText(form, name)])) as Record<
        OrganizationTextField,
        string
      >),
      isPauseaiChapter: pauseai instanceof HTMLInputElement && pauseai.checked,
    };
    setConstraint(undefined);
    // A new one's own page says it was saved; the form's status line would go with this page.
    const answer = await run(
      () =>
        organization
          ? sendToApi('PUT', `/api/organizations/${encodeURIComponent(organization.id)}`, body)
          : sendToApi('POST', '/api/organizations', body),
      organization ? text.saved : () => undefined,
    );
    if (answer && !answer.ok) {
      setConstraint(
        answer.constraint ?? (answer.error === 'incomplete' ? refusedField(body) : undefined),
      );
      return;
    }
    const created = (answer?.body as { id?: unknown } | undefined)?.id;
    if (answer?.ok && !organization && typeof created === 'string') {
      announce(text.saved, { afterNavigation: true });
      router.replace(`/platform/organizations/${created}`);
    }
  };

  const fieldError = (name: string) =>
    constraint !== undefined && constraint === name ? ERROR_ID : undefined;
  return (
    <form className={styles.form} onSubmit={submit}>
      <LocalizedField
        name="displayName"
        label={text.displayName}
        hint={text.displayNameHint}
        locales={locales}
        values={organization?.displayName}
        maxLength={200}
        requiredLabel={text.needed}
        describedBy={fieldError('localized_check')}
      />
      {FIELDS.map((field) => {
        const id = `organization-${field.name}`;
        const { label, hint } = text.fields[field.name];
        const refused = field.constraint === undefined ? undefined : fieldError(field.constraint);
        return (
          <div key={field.name} className={styles.field}>
            <label className={styles.label} htmlFor={id}>
              {label}
              {field.required ? null : <span className={styles.muted}> ({text.optional})</span>}
            </label>
            {hint ? (
              <p id={`${id}-hint`} className={styles.hint}>
                {hint}
              </p>
            ) : null}
            <input
              id={id}
              className={styles.input}
              name={field.name}
              type={field.type}
              required={field.required}
              maxLength={field.maxLength}
              pattern={field.type === 'url' ? 'https://.+' : undefined}
              autoComplete="off"
              spellCheck={field.type === 'text' ? undefined : false}
              defaultValue={organization?.[field.name] ?? ''}
              aria-invalid={refused ? true : undefined}
              aria-describedby={
                [hint ? `${id}-hint` : '', refused ?? ''].filter(Boolean).join(' ') || undefined
              }
            />
          </div>
        );
      })}
      <div className={styles.checkboxField}>
        <input
          id="organization-pauseai"
          className={styles.checkbox}
          name="isPauseaiChapter"
          type="checkbox"
          defaultChecked={organization?.isPauseaiChapter ?? false}
          aria-invalid={fieldError('pauseai') ? true : undefined}
          aria-describedby={['organization-pauseai-hint', fieldError('pauseai') ?? '']
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
      <FormMessages
        id={ERROR_ID}
        statusRef={statusLine}
        error={error}
        status={error && constraint && text.constraints[constraint] ? '' : status}
        errors={
          error && constraint && text.constraints[constraint]
            ? { ...text.errors, [error]: text.constraints[constraint] }
            : text.errors
        }
      />
      <div>
        <button className={styles.button} type="submit" aria-disabled={pending}>
          {text.save}
        </button>
      </div>
    </form>
  );
};
