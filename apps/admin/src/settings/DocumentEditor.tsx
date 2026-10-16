'use client';

import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { useRef, useState } from 'react';

import type { ProblemText } from '@/ui/checks';

import { fill } from '@/fill';
import { FormActions } from '@/ui/FormActions';
import { FormMessages } from '@/ui/FormMessages';
import { localizedFromForm } from '@/ui/forms';
import { type LocaleOption, LocalizedField } from '@/ui/LocalizedField';
import * as styles from '@/ui/styles';
import { useProblems } from '@/ui/useProblems';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

export interface DocumentEditorText {
  body: string;
  bodyHint: string;
  needed: string;
  saveDraft: string;
  publish: string;
  publishTitle: string;
  publishBody: string;
  deleteDraft: string;
  deleteTitle: string;
  deleteBody: string;
  confirmPublish: string;
  confirmDelete: string;
  cancel: string;
  saved: string;
  /** With `{version}`. */
  published: string;
  deleted: string;
  /** The body's Markdown views (PLAN R196). */
  markdown: { write: string; preview: string; empty: string };
  errors: Record<WriteError, string>;
  problems: ProblemText;
}

/** Long enough for a privacy policy; the API refuses longer. */
const MAX_LENGTH = 100_000;
const ERROR_ID = 'document-error';

/**
 * The draft of one of the operator's texts (editorial workflow T2), in Markdown per language: saved as a draft,
 * published after a confirmation (a published version never changes), or deleted. Without a draft, the form starts as
 * a copy of the published version, and saving it starts the next one (T2.2). The database decides who may write, and
 * that publishing has the default language; when that is missing, it is said under the text and its tab opens (admin
 * forms §1.2), before anything is sent.
 *
 * The fields keep what was typed across saves: the draft a first save creates is remembered at once, so the next save
 * changes it rather than starting another while the page reloads its data. They start again only after a publish or a
 * delete, from the text that is then the latest published one.
 */
export const DocumentEditor = ({
  tenant,
  kind,
  draft,
  copyOf,
  nextVersion,
  locales,
  text,
}: {
  tenant: string;
  kind: string;
  /** The draft being edited, if there is one. */
  draft: { id: string; version: number; body: Readonly<Record<string, string>> } | null;
  /** What a new draft starts from: the latest published version's text. */
  copyOf: Readonly<Record<string, string>>;
  nextVersion: number;
  locales: LocaleOption[];
  text: DocumentEditorText;
}) => {
  const [confirming, setConfirming] = useState<'publish' | 'delete'>();
  const { pending, error, status, statusLine, run, setError } = useWrite();
  const { problems, show: showProblems, form } = useProblems<'body'>();
  // The draft this form created, before the page's data has caught up with it.
  const [created, setCreated] = useState<{ id: string; version: number } | null>(null);
  // Drafts this form published or deleted, which the page's data may still show for a moment.
  const [done, setDone] = useState<string[]>([]);
  // Each publish or delete starts the fields again, from `restart`.
  const [cycle, setCycle] = useState(0);
  const [restart, setRestart] = useState<Readonly<Record<string, string>> | null>(null);
  const [show, setShow] = useState<{ code: string; times: number }>();
  const current = draft && !done.includes(draft.id) ? draft : created;
  const base = `/api/t/${encodeURIComponent(tenant)}/documents`;

  /** A language publishing needs (the default one) whose text is empty, if any. */
  const missingLanguage = (): string | undefined => {
    if (!form.current) {
      return undefined;
    }
    const body = localizedFromForm(form.current, 'body', locales);
    return locales.find((locale) => locale.required && (body[locale.code] ?? '').trim() === '')
      ?.code;
  };

  /** Publishing needs `code`'s text: said under the field, and its tab brought forward with focus in it. */
  const neededLanguage = (code: string) => {
    setError(undefined);
    showProblems({ body: text.errors.needsDefaultLanguage });
    setShow({ code, times: (show?.times ?? 0) + 1 });
  };

  const save = async (publish: boolean) => {
    if (!form.current) {
      return;
    }
    const body = localizedFromForm(form.current, 'body', locales);
    // A draft needs some text; publishing, the languages it needs (the default one).
    const needed = publish ? missingLanguage() : undefined;
    const empty = Object.values(body).every((value) => value.trim() === '');
    if (needed) {
      neededLanguage(needed);
      return;
    }
    if (showProblems(empty ? { body: text.problems.localized } : {})) {
      setError(undefined);
      return;
    }
    const version = current?.version ?? nextVersion;
    const answer = await run(
      () =>
        current
          ? sendToApi('PATCH', `${base}/${current.id}`, { body, publish })
          : sendToApi('POST', base, { kind, body, publish }),
      publish ? fill(text.published, { version: String(version) }) : text.saved,
    );
    if (!answer) {
      return;
    }
    if (!answer.ok) {
      const [first] = locales;
      if (answer.error === 'needsDefaultLanguage' && first) {
        neededLanguage(first.code);
      } else if (answer.error === 'incomplete' || answer.field === 'body') {
        setError(undefined);
        showProblems({
          body: answer.error === 'incomplete' ? text.problems.localized : text.problems.invalid,
        });
      }
      return;
    }
    const id = current?.id ?? (answer.body as { id?: string } | undefined)?.id;
    if (publish) {
      setDone((ids) => (id ? [...ids, id] : ids));
      setCreated(null);
      setRestart(body);
      setCycle((n) => n + 1);
    } else if (!current && id) {
      setCreated({ id, version });
    }
  };

  const remove = async () => {
    if (!current) {
      return;
    }
    const answer = await run(() => sendToApi('DELETE', `${base}/${current.id}`), text.deleted);
    if (answer?.ok) {
      setDone((ids) => [...ids, current.id]);
      setCreated(null);
      setRestart(copyOf);
      setCycle((n) => n + 1);
    }
  };

  // The dialog closes before the write, so what follows is announced outside it, and hands focus to the status line,
  // since the button that opened it may be gone (after Cancel, it goes back to that button).
  const confirmed = useRef(false);
  const confirm = () => {
    const action = confirming;
    confirmed.current = true;
    setConfirming(undefined);
    void (action === 'delete' ? remove() : save(true));
  };

  return (
    <form
      ref={form}
      className={styles.form}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void save(false);
      }}
    >
      <LocalizedField
        key={cycle}
        name="body"
        label={text.body}
        hint={text.bodyHint}
        locales={locales}
        values={restart ?? draft?.body ?? copyOf}
        multiline
        maxLength={MAX_LENGTH}
        requiredLabel={text.needed}
        error={problems.body}
        show={show}
        markdown={text.markdown}
      />
      <FormMessages id={ERROR_ID} error={error} errors={text.errors} />
      <FormActions label={text.saveDraft} pending={pending} status={status} statusRef={statusLine}>
        <button
          className={styles.secondaryButton}
          type="button"
          aria-disabled={pending}
          onClick={() => {
            // Said before the dialog asks anything: publishing without the default language would only be refused.
            const needed = missingLanguage();
            if (needed) {
              neededLanguage(needed);
              return;
            }
            confirmed.current = false;
            setConfirming('publish');
          }}
        >
          {text.publish}
        </button>
        {current ? (
          <button
            className={styles.secondaryButton}
            type="button"
            aria-disabled={pending}
            onClick={() => {
              confirmed.current = false;
              setConfirming('delete');
            }}
          >
            {text.deleteDraft}
          </button>
        ) : null}
      </FormActions>
      <Dialog.Root
        role="alertdialog"
        open={confirming !== undefined}
        finalFocusEl={() => (confirmed.current ? statusLine.current : null)}
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
              <Dialog.Title className={styles.dialogTitle}>
                {confirming === 'delete' ? text.deleteTitle : text.publishTitle}
              </Dialog.Title>
              <Dialog.Description>
                {confirming === 'delete' ? text.deleteBody : text.publishBody}
              </Dialog.Description>
              <div className={styles.actions}>
                <Dialog.CloseTrigger className={styles.secondaryButton}>
                  {text.cancel}
                </Dialog.CloseTrigger>
                <button className={styles.button} type="button" onClick={confirm}>
                  {confirming === 'delete' ? text.confirmDelete : text.confirmPublish}
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </form>
  );
};
