'use client';

import type { FormEvent } from 'react';

import type { Problems } from '@/ui/checks';

import { Field, FieldSelect } from '@/ui/Field';
import { FormActions } from '@/ui/FormActions';
import { FormMessages } from '@/ui/FormMessages';
import { localizedFromForm } from '@/ui/forms';
import { type LocaleOption, LocalizedField } from '@/ui/LocalizedField';
import * as styles from '@/ui/styles';
import { type Territory } from '@/ui/territory-tree';
import { type WriteError } from '@/write';

import type { ChangeAction, ChangeTarget } from './data';
import type { FieldKind } from './fields';

import { valueOf } from './form-values';
import { type ChangeInputText, ValueInput } from './inputs';
import { proposalProblems } from './problems';
import { CHANGE_ERROR_ID, useProposal } from './proposal';

export interface ChangeFormText extends ChangeInputText {
  /** "Now". */
  current: string;
  /** "New". */
  next: string;
  changed: string;
  nothingChanged: string;
  note: string;
  noteHint: string;
  propose: string;
  proposeAndApply: string;
  applyHint: string;
  proposed: string;
  applied: string;
  /** The optional report that prompted it (CR1.8). */
  report: string;
  reportHint: string;
  noReport: string;
  logo: string;
  logoHint: string;
}

/**
 * The end of every change request's form (editorial workflow CR1): the public note the corrections log will show, the
 * report it answers if any, the form's alert (for what points at no field), and "Propose", with "Propose and apply"
 * where the user may approve their own proposal (a country admin, when the site needs no second approver, CR1.5).
 */
export const ProposalEnd = ({
  locales,
  reports,
  report,
  canApply,
  pending,
  error,
  problems,
  onApply,
  text,
}: {
  locales: LocaleOption[];
  reports: { id: string; label: string }[];
  report?: string;
  canApply: boolean;
  pending: boolean;
  error: WriteError | undefined;
  problems: Problems<string>;
  onApply: (form: HTMLFormElement) => void;
  text: ChangeFormText;
}) => {
  const id = `${CHANGE_ERROR_ID}-apply-hint`;
  return (
    <>
      <LocalizedField
        name="publicNote"
        label={text.note}
        hint={text.noteHint}
        locales={locales}
        multiline
        maxLength={2_000}
        requiredLabel={text.needed}
        error={problems.publicNote}
      />
      {reports.length > 0 ? (
        <Field
          label={text.report}
          hint={text.reportHint}
          optional={text.optional}
          error={problems.reportId}
        >
          <FieldSelect
            name="reportId"
            className={styles.select}
            defaultValue={reports.some((r) => r.id === report) ? report : ''}
          >
            <option value="">{text.noReport}</option>
            {reports.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </FieldSelect>
        </Field>
      ) : null}
      <FormMessages id={CHANGE_ERROR_ID} error={error} errors={text.errors} />
      <FormActions label={text.propose} pending={pending}>
        {canApply ? (
          <button
            className={styles.secondaryButton}
            type="button"
            aria-disabled={pending}
            aria-describedby={id}
            onClick={(event) => {
              const form = event.currentTarget.form;
              if (form) {
                onApply(form);
              }
            }}
          >
            {text.proposeAndApply}
          </button>
        ) : null}
      </FormActions>
      {canApply ? (
        <p id={id} className={styles.hint}>
          {text.applyHint}
        </p>
      ) : null}
    </>
  );
};

/**
 * Proposes a new party, criterion or reviewer, or a retirement, in a live election (editorial workflow CR1), each with
 * the public note the corrections log will show. A change to what is there is the edit form's (ChangeSetForm). The
 * database decides everything again: who may propose and approve, the default-language text an approval needs, the
 * freeze window.
 */
export const ChangeForm = ({
  path,
  then,
  action,
  targetKind,
  targetId,
  fields,
  locales: offered,
  locale,
  sourceKinds,
  territories,
  canApply,
  reports = [],
  report,
  slugAddress,
  text,
}: {
  path: string;
  then: string;
  action: Exclude<ChangeAction, 'update'>;
  targetKind: ChangeTarget;
  targetId: string | null;
  /** The new row's fields (an addition), or none (a retirement). */
  fields: Readonly<Record<string, FieldKind>>;
  locales: LocaleOption[];
  /** The page's language. */
  locale: string;
  sourceKinds: readonly string[];
  /** The site's country's subdivisions (PLAN R201). */
  territories: readonly Territory[];
  canApply: boolean;
  /** The site's reports that a change may answer (CR1.8), newest first; none for whoever reads no reports. */
  reports?: { id: string; label: string }[];
  /** The report it starts linked to, when opened from one. */
  report?: string;
  /** A new row's public address, with `{slug}` where its slug goes (admin forms §1.5). */
  slugAddress?: string;
  text: ChangeFormText;
}) => {
  const {
    pending,
    error,
    problems,
    form: formRef,
    refuse,
    propose,
  } = useProposal(path, then, offered, text);
  const names = action === 'add' ? Object.keys(fields) : [];
  const values = (form: HTMLFormElement) =>
    Object.fromEntries(
      names.map((name) => [name, valueOf(form, `value.${name}`, fields[name] ?? 'text', offered)]),
    );
  /** Checked first (admin forms §1.2), then proposed, and applied with it where `apply`. */
  const submit = (form: HTMLFormElement, apply: boolean) => {
    const value = values(form);
    if (
      refuse(
        proposalProblems(
          value,
          fields,
          localizedFromForm(form, 'publicNote', offered),
          offered,
          text,
        ),
      )
    ) {
      return;
    }
    void propose(form, apply, {
      action,
      targetKind,
      targetId,
      field: null,
      ...(action === 'retire' ? {} : { value }),
    });
  };
  return (
    <form
      ref={formRef}
      className={styles.form}
      noValidate
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        submit(event.currentTarget, false);
      }}
    >
      {names.map((name) => (
        <ValueInput
          key={name}
          name={name}
          kind={fields[name] ?? 'text'}
          label={text.labels[name] ?? name}
          initial={undefined}
          locales={offered}
          locale={locale}
          sourceKinds={sourceKinds}
          territories={territories}
          error={problems[name]}
          slug={{
            from: `value.${fields.name ? 'name' : 'title'}.${offered[0]?.code ?? ''}`,
            address: slugAddress,
          }}
          text={text}
        />
      ))}
      <ProposalEnd
        locales={offered}
        reports={reports}
        report={report}
        canApply={canApply}
        pending={pending}
        error={error}
        problems={problems}
        onApply={(form) => submit(form, true)}
        text={text}
      />
    </form>
  );
};
