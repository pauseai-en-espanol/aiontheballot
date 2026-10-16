'use client';

import { FileUpload, type FileUploadFileRejectDetails } from '@ark-ui/react/file-upload';
import { useId, useState } from 'react';

import { fileSize } from './image-field';
import * as styles from './styles';

export interface FileFieldText {
  /** "Drop a file here, or". */
  drop: string;
  choose: string;
  replace: string;
  remove: string;
  /** Said of the chosen file: with `{name}`, `{size}` and `{type}`. */
  chosen: string;
  none: string;
  problems: { type: string; size: string; missing: string };
}

/** A file's type as people name it, for the chip (anything else by its media type). */
const TYPE_NAMES: Readonly<Record<string, string>> = {
  'application/pdf': 'PDF',
  'text/html': 'HTML',
  'text/plain': 'TXT',
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
};

/**
 * A document field (admin forms §1.1, PLAN R194): a drop zone and a button to choose a file, and the file once chosen
 * as a line with its name, size and type; its type and size checked here, in words, so a wrong file costs no upload (the
 * API checks both again, and the bytes). It holds the choice only: the form uploads the file when it saves, so a
 * source's copy can be chosen with the source itself. Every control is a real button, reachable by keyboard.
 */
export const FileField = ({
  label,
  hint,
  accept,
  maxBytes,
  value,
  onChange,
  error,
  describedBy,
  locale,
  text,
}: {
  label: string;
  hint?: string;
  /** The media types it takes. */
  accept: readonly string[];
  maxBytes: number;
  value: File | null;
  onChange: (file: File | null) => void;
  /** A problem with it from the form or the API. */
  error?: string | undefined;
  /** Other text that describes it (what storing a file means, say). */
  describedBy?: string;
  locale: string;
  text: FileFieldText;
}) => {
  const id = useId();
  const [problem, setProblem] = useState<string>();
  const message = problem ?? error;
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  const statusId = `${id}-status`;
  const errorId = `${id}-error`;
  const described = [hint ? hintId : null, statusId, describedBy ?? null, message ? errorId : null]
    .filter(Boolean)
    .join(' ');

  const reject = ({ files }: FileUploadFileRejectDetails) => {
    const errors = files.flatMap((rejection) => rejection.errors);
    setProblem(errors.includes('FILE_TOO_LARGE') ? text.problems.size : text.problems.type);
  };

  return (
    <div className={styles.field}>
      <span id={labelId} className={styles.label}>
        {label}
      </span>
      {hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      <FileUpload.Root
        accept={[...accept]}
        maxFiles={1}
        maxFileSize={maxBytes}
        // Held by the form, not here: each pick is a new one, never "too many files".
        acceptedFiles={[]}
        onFileAccept={({ files }) => {
          const [picked] = files;
          if (picked) {
            setProblem(undefined);
            onChange(picked);
          }
        }}
        onFileReject={reject}
        translations={{ dropzone: label }}
      >
        <FileUpload.Dropzone
          disableClick
          className={styles.dropzone}
          role="group"
          aria-labelledby={labelId}
          aria-describedby={described}
          aria-label={undefined}
          data-invalid={message ? '' : undefined}
        >
          {value ? null : <span>{text.drop}</span>}
          <p id={statusId} className={value ? styles.text : styles.hint} aria-live="polite">
            {value
              ? // One pass, by function: a file's name is never read as a pattern or a placeholder.
                text.chosen.replace(/\{(name|size|type)\}/gu, (_, key: string) =>
                  key === 'name'
                    ? value.name
                    : key === 'size'
                      ? fileSize(value.size, locale)
                      : (TYPE_NAMES[value.type] ?? value.type),
                )
              : text.none}
          </p>
          <div className={styles.buttonRow}>
            {/* Marked when something is wrong, so a form's first problem can take focus here. */}
            <FileUpload.Trigger
              className={styles.secondaryButton}
              aria-invalid={message ? true : undefined}
              aria-describedby={message ? errorId : undefined}
            >
              {value ? text.replace : text.choose}
            </FileUpload.Trigger>
            {value ? (
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => {
                  setProblem(undefined);
                  onChange(null);
                }}
              >
                {text.remove}
              </button>
            ) : null}
          </div>
        </FileUpload.Dropzone>
        <FileUpload.HiddenInput />
      </FileUpload.Root>
      {message ? (
        <p id={errorId} className={styles.fieldError}>
          <span aria-hidden="true">⚠</span>
          <span>{message}</span>
        </p>
      ) : null}
    </div>
  );
};
