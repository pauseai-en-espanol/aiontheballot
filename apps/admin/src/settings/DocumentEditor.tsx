'use client';

import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { useRef, useState } from 'react';

import { fill } from '@/fill';
import { FormMessages } from '@/ui/FormMessages';
import { localizedFromForm } from '@/ui/forms';
import { type LocaleOption, LocalizedField } from '@/ui/LocalizedField';
import * as styles from '@/ui/styles';
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
  errors: Record<WriteError, string>;
}

/** Long enough for a privacy policy; the API refuses longer. */
const MAX_LENGTH = 100_000;
const ERROR_ID = 'document-error';

/**
 * The draft of one of the operator's texts (editorial workflow T2), in Markdown per language: saved as a draft,
 * published after a confirmation (a published version never changes), or deleted. Without a draft, the form starts as
 * a copy of the published version, and saving it starts the next one (T2.2). The database decides who may write, and
 * that publishing has the default language; when that is missing, its tab opens.
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
  const form = useRef<HTMLFormElement>(null);
  const [confirming, setConfirming] = useState<'publish' | 'delete'>();
  const { pending, error, status, statusLine, run } = useWrite();
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

  const save = async (publish: boolean) => {
    if (!form.current) {
      return;
    }
    const body = localizedFromForm(form.current, 'body', locales);
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
        setShow({ code: first.code, times: (show?.times ?? 0) + 1 });
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
        describedBy={error ? ERROR_ID : undefined}
        show={show}
      />
      <FormMessages
        id={ERROR_ID}
        error={error}
        status={status}
        statusRef={statusLine}
        errors={text.errors}
      />
      <div className={styles.buttonRow}>
        <button className={styles.button} type="submit" aria-disabled={pending}>
          {text.saveDraft}
        </button>
        <button
          className={styles.secondaryButton}
          type="button"
          aria-disabled={pending}
          onClick={() => {
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
      </div>
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
