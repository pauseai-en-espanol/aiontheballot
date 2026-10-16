'use client';

import { type FormEvent, useState } from 'react';

import type { ImageChoice } from '@/ui/image-field';

import { localizedFromForm } from '@/ui/forms';
import { ImageField, type ImageFieldText } from '@/ui/ImageField';
import { type LocaleOption } from '@/ui/LocalizedField';
import * as styles from '@/ui/styles';
import { type Territory } from '@/ui/territory-tree';
import { uploadToApi } from '@/write';

import type { ChangeTarget } from './data';
import type { FieldKind } from './fields';

import { type ChangeFormText, ProposalEnd } from './ChangeForm';
import { valueOf } from './form-values';
import { ShownValue, ValueInput } from './inputs';
import { proposalProblems } from './problems';
import { CHANGE_ERROR_ID, useProposal } from './proposal';
import { changedValues, sameValue } from './values';

/**
 * A change to what a live election's party, criterion, reviewer, methodology or the election itself says (PLAN R183;
 * editorial workflow CR1): every field it may change, each with what it is now beside its new value, starting the
 * same; one public note; and one request with just the fields that differ, proposed, reviewed and applied as one. A
 * party's new logo is uploaded first, to the site's images, where nothing names it until the request is approved. The
 * database reads each field's value now again, refuses the request once any of them changed meanwhile, and checks
 * everything an approval needs.
 */
export const ChangeSetForm = ({
  path,
  then,
  targetKind,
  targetId,
  fields,
  current,
  logo,
  locales,
  locale,
  sourceKinds,
  territories,
  canApply,
  reports = [],
  report,
  text,
  imageText,
}: {
  path: string;
  then: string;
  targetKind: ChangeTarget;
  targetId: string;
  fields: Readonly<Record<string, FieldKind>>;
  /** The target's values now, by column. */
  current: Readonly<Record<string, unknown>>;
  /** A party's logo now, as members see it, where it uploads a new one, and its alternative text. */
  logo?: { src: string | null; upload: string; alt: string };
  locales: LocaleOption[];
  locale: string;
  sourceKinds: readonly string[];
  /** The site's country's subdivisions (PLAN R201). */
  territories: readonly Territory[];
  canApply: boolean;
  reports?: { id: string; label: string }[];
  report?: string;
  text: ChangeFormText;
  imageText: ImageFieldText;
}) => {
  const {
    pending,
    error,
    problems,
    form: formRef,
    refuse,
    propose,
    setError,
  } = useProposal(path, then, locales, text);
  const [image, setImage] = useState<ImageChoice>({ kind: 'keep' });
  const [changed, setChanged] = useState<ReadonlySet<string>>(new Set());
  const [nothing, setNothing] = useState(false);
  const names = Object.keys(fields);

  /** Every field's new value as the form has it now (a logo's, by what will be sent). */
  const read = (form: HTMLFormElement): Record<string, unknown> =>
    Object.fromEntries(
      names
        .filter((name) => fields[name] !== 'logo')
        .map((name) => [name, valueOf(form, `value.${name}`, fields[name] ?? 'text', locales)]),
    );
  const mark = (form: HTMLFormElement) => {
    const next = read(form);
    // A logo's mark is its field's own to set (onChange below).
    setChanged(
      (was) =>
        new Set(
          names.filter((name) =>
            fields[name] === 'logo'
              ? was.has(name)
              : !sameValue(fields[name] ?? 'text', current[name], next[name]),
          ),
        ),
    );
    setNothing(false);
  };

  const submit = (form: HTMLFormElement, apply: boolean) => {
    const values = changedValues(fields, current, read(form));
    if (Object.keys(values).length === 0 && image.kind === 'keep') {
      refuse({});
      setNothing(true);
      setError(undefined);
      requestAnimationFrame(() => document.getElementById(`${CHANGE_ERROR_ID}-nothing`)?.focus());
      return;
    }
    // Only what changes is checked, as only that is sent (admin forms §1.2).
    if (
      refuse(
        proposalProblems(
          values,
          fields,
          localizedFromForm(form, 'publicNote', locales),
          locales,
          text,
        ),
      )
    ) {
      return;
    }
    void propose(form, apply, async () => {
      if (image.kind === 'new' && logo) {
        const uploaded = await uploadToApi(logo.upload, image.file);
        if (!uploaded.ok) {
          // Said at the logo's field.
          return { ...uploaded, constraint: 'logo' };
        }
        const fileId = (uploaded.body as { fileId?: unknown } | undefined)?.fileId;
        // An answer without the file's id is no upload: never propose removing the logo instead.
        if (typeof fileId !== 'string') {
          return { ok: false, error: 'unexpected', constraint: 'logo' };
        }
        values.logo_file_id = fileId;
      } else if (image.kind === 'remove') {
        values.logo_file_id = null;
      }
      return { action: 'update', targetKind, targetId, field: null, values };
    });
  };

  const row = (name: string) => {
    const kind = fields[name] ?? 'text';
    const label = text.labels[name] ?? name;
    const isChanged = changed.has(name);
    const heading = (
      <span className={styles.label}>
        {label}
        {isChanged ? (
          <span className={styles.changedMark}>
            <span aria-hidden="true">✎</span> {text.changed}
          </span>
        ) : null}
      </span>
    );
    if (kind === 'logo' && logo) {
      return (
        <div key={name} className={styles.changeRow}>
          <div className={styles.changeNow}>
            {heading}
            <span className={styles.hint}>{text.current}</span>
            {logo.src ? (
              <div className={styles.imageBox}>
                {/* The API's members-only image: nothing for next/image to do. */}
                {/* oxlint-disable-next-line next/no-img-element */}
                <img src={logo.src} alt={logo.alt} />
              </div>
            ) : (
              <span>{text.none}</span>
            )}
          </div>
          <ImageField
            label={`${label} (${text.next})`}
            hint={text.logoHint}
            current={logo.src}
            alt={logo.alt}
            value={image}
            onChange={(choice) => {
              setImage(choice);
              setChanged((was) => {
                const next = new Set(was);
                if (choice.kind === 'keep') {
                  next.delete(name);
                } else {
                  next.add(name);
                }
                return next;
              });
            }}
            error={problems.logo}
            locale={locale}
            text={imageText}
          />
        </div>
      );
    }
    const now = current[name];
    return (
      <div key={name} className={styles.changeRow}>
        <div className={styles.changeNow}>
          {heading}
          <span className={styles.hint}>{text.current}</span>
          {kind === 'localizedLong' ? (
            <details className={styles.details}>
              <summary className={styles.summary}>{text.current}</summary>
              <p className={styles.prose}>
                <ShownValue value={now} text={text} />
              </p>
            </details>
          ) : kind === 'colour' && typeof now === 'string' ? (
            <span className={styles.prefixed}>
              <span className={styles.swatch} style={{ backgroundColor: now }} aria-hidden="true" />
              {now}
            </span>
          ) : (
            <span>
              <ShownValue value={now} text={text} />
            </span>
          )}
        </div>
        <ValueInput
          name={name}
          kind={kind}
          label={`${label} (${text.next})`}
          initial={now}
          locales={locales}
          locale={locale}
          sourceKinds={sourceKinds}
          territories={territories}
          error={problems[name]}
          onChanged={() => {
            if (formRef.current) {
              mark(formRef.current);
            }
          }}
          text={text}
        />
      </div>
    );
  };

  return (
    <form
      ref={formRef}
      className={styles.form}
      noValidate
      // After the render each event causes, so a colour's own state is read as it now is.
      onInput={(event) => {
        const form = event.currentTarget;
        requestAnimationFrame(() => mark(form));
      }}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        submit(event.currentTarget, false);
      }}
    >
      <div>{names.map(row)}</div>
      {nothing ? (
        <p id={`${CHANGE_ERROR_ID}-nothing`} className={styles.alert} tabIndex={-1} role="alert">
          <span>
            <span aria-hidden="true">⚠ </span>
            {text.nothingChanged}
          </span>
        </p>
      ) : null}
      <ProposalEnd
        locales={locales}
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
