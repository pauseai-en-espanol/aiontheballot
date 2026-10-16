'use client';

import { type FormEvent, useId, useState } from 'react';

import { announce } from '@/ui/announce';
import { FormMessages } from '@/ui/FormMessages';
import * as styles from '@/ui/styles';
import { useWrite } from '@/ui/useWrite';
import { uploadToApi, type WriteError } from '@/write';

import { announceOwnChange } from './own-version';
import { StaleNotice } from './StaleNotice';

/** What an attestation file may be (C4.1; PLAN R171), as the API takes it: a screenshot, or a video or audio clip. */
const ACCEPT = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/webm',
].join(',');
const MAX_BYTES = 50 * 1024 * 1024;

/**
 * Attaches a screenshot or clip to a quote from a source without text (editorial workflow C4.1): the file goes to the
 * API as it is, kept once per site, and the quote names it. Storing it is a change of the quote, which undoes an
 * attestation, and makes whoever stores it a contributor of the cell, as the form says before anything is sent. The
 * size and type checks here only save a wasted upload: the API checks both again.
 */
export const AttestationUpload = ({
  path,
  version,
  label,
  text,
}: {
  /** The quote's attestation file route in the API. */
  path: string;
  version: number;
  /** The file field's label, which names the quote. */
  label: string;
  text: {
    fileHint: string;
    contributor: string;
    upload: string;
    uploaded: string;
    stale: string;
    reload: string;
    errors: Record<WriteError, string>;
  };
}) => {
  const { pending, error, run, setError } = useWrite();
  const [file, setFile] = useState<File>();
  const [stale, setStale] = useState(false);
  const id = useId();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStale(false);
    if (!file) {
      setError('incomplete');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('tooLarge');
      return;
    }
    if (!ACCEPT.split(',').includes(file.type)) {
      setError('fileType');
      return;
    }
    const answer = await run(
      async () => {
        const sent = await uploadToApi(path, file, { version: String(version) });
        if (sent.ok) {
          announceOwnChange(version, sent.body);
        }
        return sent;
      },
      () => undefined,
    );
    if (answer?.ok) {
      announce(text.uploaded);
    }
    if (answer?.error === 'cellChanged') {
      setStale(true);
    }
  };
  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${id}-file`}>
          {label}
        </label>
        <p id={`${id}-hint`} className={styles.hint}>
          {text.fileHint}
        </p>
        <p id={`${id}-contributor`} className={styles.hint}>
          {text.contributor}
        </p>
        <input
          id={`${id}-file`}
          className={styles.input}
          type="file"
          name="file"
          accept={ACCEPT}
          required
          onChange={(event) => setFile(event.target.files?.[0])}
          aria-describedby={[`${id}-hint`, `${id}-contributor`, error ? `${id}-error` : '']
            .join(' ')
            .trim()}
        />
      </div>
      <FormMessages
        id={`${id}-error`}
        error={stale ? undefined : error}
        status=""
        errors={text.errors}
      />
      {stale ? <StaleNotice text={text} /> : null}
      <div>
        <button className={styles.secondaryButton} type="submit" aria-disabled={pending}>
          {text.upload}
        </button>
      </div>
    </form>
  );
};
