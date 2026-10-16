'use client';

import { type FormEvent, useId, useState } from 'react';

import { announce } from '@/ui/announce';
import { FileField, type FileFieldText } from '@/ui/FileField';
import { FormActions } from '@/ui/FormActions';
import { FormMessages } from '@/ui/FormMessages';
import * as styles from '@/ui/styles';
import { useProblems } from '@/ui/useProblems';
import { useWrite } from '@/ui/useWrite';
import { uploadToApi, type WriteError } from '@/write';

import { COPY_TYPES, MAX_COPY_BYTES } from './copy';

/**
 * Stores a source's copy (editorial workflow S2.2): the file goes to the API as it is, which keeps it once per site
 * and asks for its text. Before anything is sent, the form says what storing it means under four-eyes (S2.3), and
 * that the source can't change afterwards (S1.2). The file is chosen in a `FileField` (PLAN R194), whose type and
 * size checks only save a wasted upload: the API checks both again.
 */
export const UploadForm = ({
  path,
  locale,
  text,
}: {
  /** The source's copy route in the API. */
  path: string;
  locale: string;
  text: {
    file: string;
    fileHint: string;
    contributor: string;
    final: string;
    upload: string;
    uploaded: string;
    errors: Record<WriteError, string>;
    fileField: FileFieldText;
  };
}) => {
  const { pending, error, run, setError } = useWrite();
  const { problems, show, form } = useProblems<'file'>();
  const [file, setFile] = useState<File | null>(null);
  const id = useId();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file) {
      show({ file: text.fileField.problems.missing });
      setError(undefined);
      return;
    }
    show({});
    // Stored, the copy replaces this form on the reloaded page: the page's own status line says so (announce.ts).
    const answer = await run(
      () => uploadToApi(path, file),
      () => undefined,
    );
    if (answer?.ok) {
      announce(text.uploaded);
    } else if (answer?.error === 'tooLarge' || answer?.error === 'fileType') {
      show({ file: text.errors[answer.error] });
      setError(undefined);
    }
  };
  return (
    <form ref={form} className={styles.form} onSubmit={submit} noValidate>
      <p id={`${id}-contributor`} className={styles.notice}>
        {text.contributor}
      </p>
      <p id={`${id}-final`} className={styles.hint}>
        {text.final}
      </p>
      <FileField
        label={text.file}
        hint={text.fileHint}
        accept={COPY_TYPES}
        maxBytes={MAX_COPY_BYTES}
        value={file}
        onChange={setFile}
        error={problems.file}
        describedBy={`${id}-contributor`}
        locale={locale}
        text={text.fileField}
      />
      <FormMessages id={`${id}-error`} error={error} errors={text.errors} />
      <FormActions label={text.upload} pending={pending} />
    </form>
  );
};
