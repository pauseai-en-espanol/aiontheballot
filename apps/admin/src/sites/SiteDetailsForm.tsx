'use client';

import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { type FormEvent, useState } from 'react';

import { type Problems, type ProblemText, refusalProblem } from '@/ui/checks';
import { Field, FieldSelect } from '@/ui/Field';
import { FormActions } from '@/ui/FormActions';
import { FormMessages } from '@/ui/FormMessages';
import { formText, localizedFromForm } from '@/ui/forms';
import { type LocaleOption, LocalizedField } from '@/ui/LocalizedField';
import * as styles from '@/ui/styles';
import { useProblems } from '@/ui/useProblems';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

export interface SiteDetailsText {
  name: string;
  nameHint: string;
  needed: string;
  languages: string;
  /** That the main language doesn't change: with `{language}`. */
  mainLanguage: string;
  operator: string;
  operatorHint: string;
  chooseOperator: string;
  /** When the site's restricted images need a PauseAI chapter to run it. */
  restrictedOperator: string;
  save: string;
  saved: string;
  /** Asked before a change of operator or the removal of a language (the review of R195). */
  confirmTitle: string;
  /** With `{name}`. */
  operatorChange: string;
  /** With `{languages}`. */
  languagesRemoved: string;
  confirm: string;
  cancel: string;
  errors: Record<WriteError, string>;
  problems: ProblemText;
}

type DetailsField = 'name' | 'enabledLocales' | 'operator';

/**
 * A site's name, its other languages and its operator (admin forms §2, settings and platform; PLAN R195), which a
 * platform admin changes in place. Its main language is shown and kept: the public addresses are in its words. The
 * name is sent in the site's languages only. What is wrong shows at its field and the first takes focus (§1.2); the
 * database checks it all again, and that a site using PauseAI's restricted images keeps a PauseAI chapter running it.
 * A new operator, which changes the site's legal notice and who is responsible for its reports and signups, and a
 * language removed, whose pages go, are said in a dialog and confirmed before anything is sent.
 */
export const SiteDetailsForm = ({
  slug,
  defaultLocale,
  enabledLocales,
  name,
  operatorId,
  locales,
  organizations,
  text,
}: {
  slug: string;
  defaultLocale: string;
  enabledLocales: readonly string[];
  name: Readonly<Record<string, string>>;
  operatorId: string | null;
  /** The languages the platform has messages for, the site's main one first. */
  locales: LocaleOption[];
  organizations: { id: string; name: string; lang: string }[];
  text: SiteDetailsText;
}) => {
  const { pending, error, status, statusLine, run, setError } = useWrite();
  const { problems, show, form: formRef } = useProblems<DetailsField>();
  const [confirming, setConfirming] = useState<{
    body: { name: Record<string, string>; enabledLocales: string[]; operatorId: string };
    lines: string[];
  }>();

  /** The site's languages: its main one, then those ticked. */
  const siteLocales = (form: HTMLFormElement) => [
    ...new Set([defaultLocale, ...new FormData(form).getAll('enabledLocales').map(String)]),
  ];

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const languages = siteLocales(form);
    const siteName = Object.fromEntries(
      Object.entries(localizedFromForm(form, 'name', locales)).filter(([code]) =>
        languages.includes(code),
      ),
    );
    const operator = formText(form, 'operatorId');
    const found: Problems<DetailsField> = {};
    if (Object.values(siteName).every((value) => value.trim() === '')) {
      found.name = text.problems.localized;
    }
    if (operator === '') {
      found.operator = text.problems.choose;
    }
    if (show(found)) {
      setError(undefined);
      return;
    }
    const body = { name: siteName, enabledLocales: languages, operatorId: operator };
    const removed = enabledLocales.filter((code) => !languages.includes(code));
    const lines = [
      ...(operatorId !== null && operator !== operatorId
        ? [
            text.operatorChange.replace(
              '{name}',
              organizations.find((organization) => organization.id === operator)?.name ?? '',
            ),
          ]
        : []),
      ...(removed.length > 0
        ? [
            text.languagesRemoved.replace(
              '{languages}',
              removed
                .map((code) => locales.find((locale) => locale.code === code)?.label ?? code)
                .join(', '),
            ),
          ]
        : []),
    ];
    if (lines.length > 0) {
      setConfirming({ body, lines });
      return;
    }
    await save(body);
  };

  const save = async (body: {
    name: Record<string, string>;
    enabledLocales: string[];
    operatorId: string;
  }) => {
    setConfirming(undefined);
    const answer = await run(
      () => sendToApi('PATCH', `/api/sites/${encodeURIComponent(slug)}`, body),
      text.saved,
    );
    if (answer && !answer.ok) {
      // With no field or constraint named, `incomplete` is the database's rule for restricted images, at commit.
      const pointed =
        answer.error === 'incomplete' && answer.field === undefined && !answer.constraint
          ? { operator: text.restrictedOperator }
          : refusalProblem(
              answer,
              { tenant_organizations_organization_id_fkey: ['operator', text.problems.invalid] },
              {
                name: [
                  'name',
                  answer.error === 'incomplete' ? text.problems.localized : text.problems.invalid,
                ],
                enabledLocales: ['enabledLocales', text.problems.invalid],
                operatorId: ['operator', text.problems.invalid],
              },
            );
      if (pointed && show(pointed)) {
        setError(undefined);
      }
    }
  };

  const mainLanguage = locales.find((locale) => locale.code === defaultLocale);
  return (
    <form ref={formRef} className={styles.form} onSubmit={submit} noValidate>
      <LocalizedField
        name="name"
        label={text.name}
        hint={text.nameHint}
        locales={locales}
        values={name}
        maxLength={200}
        requiredLabel={text.needed}
        error={problems.name}
      />
      <fieldset className={styles.fieldset} aria-describedby="site-details-main-language">
        <legend className={styles.label}>{text.languages}</legend>
        <p id="site-details-main-language" className={styles.hint}>
          {text.mainLanguage.replace('{language}', mainLanguage?.label ?? defaultLocale)}
        </p>
        {locales
          .filter((locale) => locale.code !== defaultLocale)
          .map((locale, index) => (
            <div key={locale.code} className={styles.checkboxField}>
              <input
                id={`site-details-locale-${locale.code}`}
                className={styles.checkbox}
                name="enabledLocales"
                type="checkbox"
                value={locale.code}
                defaultChecked={enabledLocales.includes(locale.code)}
                aria-invalid={index === 0 && problems.enabledLocales ? true : undefined}
                aria-describedby={
                  index === 0 && problems.enabledLocales ? 'site-details-locales-error' : undefined
                }
              />
              <label className={styles.label} htmlFor={`site-details-locale-${locale.code}`}>
                {locale.label}
              </label>
            </div>
          ))}
        {problems.enabledLocales ? (
          <p id="site-details-locales-error" className={styles.fieldError}>
            <span aria-hidden="true">⚠</span>
            <span>{problems.enabledLocales}</span>
          </p>
        ) : null}
      </fieldset>
      <Field label={text.operator} hint={text.operatorHint} error={problems.operator} required>
        <FieldSelect className={styles.select} name="operatorId" defaultValue={operatorId ?? ''}>
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
      <FormMessages id="site-details-error" error={error} errors={text.errors} />
      <FormActions label={text.save} pending={pending} status={status} statusRef={statusLine} />
      <Dialog.Root
        role="alertdialog"
        open={confirming !== undefined}
        onOpenChange={({ open }) => {
          if (!open) {
            setConfirming(undefined);
          }
        }}
      >
        <Portal>
          <Dialog.Backdrop className={styles.backdrop} />
          <Dialog.Positioner className={styles.dialogPositioner}>
            <Dialog.Content className={styles.dialog}>
              <Dialog.Title className={styles.dialogTitle}>{text.confirmTitle}</Dialog.Title>
              <Dialog.Description asChild>
                <div>
                  {confirming?.lines.map((line) => (
                    <p key={line} className={styles.text}>
                      {line}
                    </p>
                  ))}
                </div>
              </Dialog.Description>
              <div className={styles.actions}>
                <Dialog.CloseTrigger className={styles.secondaryButton}>
                  {text.cancel}
                </Dialog.CloseTrigger>
                <button
                  className={styles.button}
                  type="button"
                  onClick={() => {
                    if (confirming) {
                      void save(confirming.body);
                    }
                  }}
                >
                  {text.confirm}
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </form>
  );
};
