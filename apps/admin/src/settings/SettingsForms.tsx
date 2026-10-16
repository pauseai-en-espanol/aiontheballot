'use client';

import type { FormEvent } from 'react';

import { AA_TEXT, readableText } from '@aiontheballot/domain/site-theme';
import { useState } from 'react';

import { fill } from '@/fill';
import { checkValues, type ProblemText } from '@/ui/checks';
import { Field, FieldInput } from '@/ui/Field';
import { FormActions } from '@/ui/FormActions';
import { FormMessages } from '@/ui/FormMessages';
import { formText } from '@/ui/forms';
import * as styles from '@/ui/styles';
import { useProblems } from '@/ui/useProblems';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

import { shownRatio } from './shown-ratio';

const settingsPath = (tenant: string) => `/api/t/${encodeURIComponent(tenant)}/settings`;

/** The bounds of a site's retention, as the database keeps them. */
const RETENTION = { min: 1, max: 36_500 } as const;

/**
 * How long reports are kept before they are anonymized (editorial workflow T3): country admins and platform admins
 * change it; the database decides. A change applies to reports sent from then on, which the hint says. A number out of
 * bounds is said at the field (admin forms §1.2).
 */
export const RetentionForm = ({
  tenant,
  days,
  text,
}: {
  tenant: string;
  days: number;
  text: {
    label: string;
    hint: string;
    save: string;
    saved: string;
    errors: Record<WriteError, string>;
    problems: ProblemText;
  };
}) => {
  const { pending, error, status, statusLine, run, setError } = useWrite();
  const { problems, show, form } = useProblems<'days'>();
  const outOfBounds = text.problems.whole
    .replace('{min}', String(RETENTION.min))
    .replace('{max}', String(RETENTION.max));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const typed = formText(event.currentTarget, 'days').trim();
    if (
      show(
        checkValues({ days: typed }, { days: { required: true, whole: RETENTION } }, text.problems),
      )
    ) {
      setError(undefined);
      return;
    }
    const answer = await run(
      () => sendToApi('PATCH', settingsPath(tenant), { reportRetentionDays: Number(typed) }),
      text.saved,
    );
    // The form's one field: a value the API or the database refuses is its.
    if (
      answer &&
      !answer.ok &&
      (answer.error === 'invalid' || answer.error === 'incomplete') &&
      show({ days: outOfBounds })
    ) {
      setError(undefined);
    }
  };
  return (
    <form ref={form} className={styles.form} onSubmit={submit} noValidate>
      <Field label={text.label} hint={text.hint} error={problems.days} required>
        <FieldInput
          className={styles.numberInput}
          name="days"
          type="number"
          inputMode="numeric"
          step={1}
          defaultValue={days}
        />
      </Field>
      <FormMessages id={'retention-error'} error={error} errors={text.errors} />
      <FormActions label={text.save} pending={pending} status={status} statusRef={statusLine} />
    </form>
  );
};

/**
 * Whether a second person must approve changes to a live election (editorial workflow P1): only platform admins
 * change it, audited; the database refuses anyone else.
 */
export const LiveEditsForm = ({
  tenant,
  on,
  text,
}: {
  tenant: string;
  on: boolean;
  text: {
    label: string;
    hint: string;
    save: string;
    saved: string;
    errors: Record<WriteError, string>;
  };
}) => {
  const { pending, error, status, statusLine, run } = useWrite();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get('on') === 'on';
    await run(
      () => sendToApi('PATCH', settingsPath(tenant), { liveEditsNeedSecondApprover: value }),
      text.saved,
    );
  };
  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <div className={styles.checkboxField}>
        <input
          id="live-edits"
          className={styles.checkbox}
          name="on"
          type="checkbox"
          defaultChecked={on}
          aria-describedby={['live-edits-hint', error ? 'live-edits-error' : ''].join(' ').trim()}
        />
        <label className={styles.label} htmlFor="live-edits">
          {text.label}
        </label>
      </div>
      <p id="live-edits-hint" className={styles.hint}>
        {text.hint}
      </p>
      <FormMessages id={'live-edits-error'} error={error} errors={text.errors} />
      <FormActions label={text.save} pending={pending} status={status} statusRef={statusLine} />
    </form>
  );
};

/**
 * The site's own colour (editorial workflow T1, PLAN R178): its accent, behind its name on every page and on every
 * share image, which country admins and platform admins choose. The preview shows the ink or paper the site will
 * write on it, and says when neither reads at WCAG AA, which the API refuses too; "use the platform's colour" removes
 * the site's own.
 */
export const ColourForm = ({
  tenant,
  accent,
  platform,
  locale,
  text,
}: {
  tenant: string;
  /** The page's language, for the contrast ratio's decimal separator. */
  locale: string;
  /** The site's own, if it has one. */
  accent: string | undefined;
  /** The platform's, which stands for it otherwise. */
  platform: string;
  text: {
    label: string;
    hint: string;
    sample: string;
    readable: string;
    unreadable: string;
    save: string;
    reset: string;
    saved: string;
    resetDone: string;
    errors: Record<WriteError, string>;
  };
}) => {
  const { pending, error, status, statusLine, run } = useWrite();
  const [colour, setColour] = useState((accent ?? platform).toLowerCase());
  const { text: ink, ratio } = readableText(colour);
  const readable = ratio >= AA_TEXT;
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // The verdict below says why; the API would refuse it too.
    if (!readable) {
      return;
    }
    await run(
      () => sendToApi('PATCH', settingsPath(tenant), { theme: { accent: colour } }),
      text.saved,
    );
  };
  const reset = async () => {
    const answer = await run(
      () => sendToApi('PATCH', settingsPath(tenant), { theme: { accent: null } }),
      text.resetDone,
    );
    // Only once it is gone: after a refusal the site keeps its own, and the picker shows it still.
    if (answer?.ok) {
      setColour(platform.toLowerCase());
    }
  };
  const words = (template: string) => fill(template, { colour, ratio: shownRatio(ratio, locale) });
  return (
    <form className={styles.form} onSubmit={save} noValidate>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="site-accent">
          {text.label}
        </label>
        <p id="site-accent-hint" className={styles.hint}>
          {text.hint}
        </p>
        <input
          id="site-accent"
          name="accent"
          type="color"
          value={colour}
          onChange={(event) => setColour(event.currentTarget.value.toLowerCase())}
          aria-describedby="site-accent-hint site-accent-verdict"
          className={styles.colourInput}
        />
      </div>
      <div
        className={styles.colourSample}
        // The site's colour itself, which no class can know in advance.
        style={{ backgroundColor: colour, color: ink }}
      >
        {text.sample}
      </div>
      <p
        id="site-accent-verdict"
        aria-live="polite"
        className={readable ? styles.hint : styles.warning}
      >
        {readable ? null : <span aria-hidden="true">⚠ </span>}
        {words(readable ? text.readable : text.unreadable)}
      </p>
      <FormMessages id="site-accent-error" error={error} errors={text.errors} />
      <FormActions
        label={text.save}
        pending={pending || !readable}
        status={status}
        statusRef={statusLine}
      >
        {accent ? (
          <button
            className={styles.secondaryButton}
            type="button"
            aria-disabled={pending}
            onClick={reset}
          >
            {text.reset}
          </button>
        ) : null}
      </FormActions>
    </form>
  );
};
