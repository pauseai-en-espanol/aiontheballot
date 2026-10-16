'use client';

import { FileUpload, type FileUploadFileRejectDetails } from '@ark-ui/react/file-upload';
import { useEffect, useId, useMemo, useState } from 'react';

import {
  fileSize,
  IMAGE_TYPES,
  type ImageChoice,
  type ImageProblem,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_SIDE,
} from './image-field';
import * as styles from './styles';

export interface ImageFieldText {
  /** "Drop an image here, or". */
  drop: string;
  choose: string;
  replace: string;
  remove: string;
  undo: string;
  /** Said of a new file: with `{name}` and `{size}`. */
  chosen: string;
  /** Said once the image there now is to be removed. */
  removing: string;
  none: string;
  problems: Record<ImageProblem, string>;
}

/** Whether an image's sides are within the API's limits, read from the image itself; undefined if it can't be read. */
const readSides = (file: File): Promise<{ width: number; height: number } | undefined> =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      resolve(undefined);
      URL.revokeObjectURL(url);
    };
    image.src = url;
  });

/**
 * An image field (admin forms §1.1): a drop zone and a button to choose a file; the image as it will show, previewed
 * from the file before anything is uploaded, on a checkerboard so transparency reads as such; its type, size and
 * sides checked here, in words, so a wrong file costs no upload (the API checks all three again, and the bytes); and
 * Replace, Remove and Undo. It holds the choice only: the form uploads a new file, or removes the image, when it saves
 * (so a party's logo can be chosen before the party exists). Every control is a real button, reachable by keyboard.
 */
export const ImageField = ({
  label,
  hint,
  optional,
  current,
  alt,
  value,
  onChange,
  error,
  locale,
  text,
}: {
  label: string;
  hint?: string;
  optional?: string;
  /** The image there is now, as members see it; null without one. */
  current: string | null;
  /** The image's alternative text, now and as it will be. */
  alt: string;
  value: ImageChoice;
  onChange: (choice: ImageChoice) => void;
  /** A refusal from the API, for this field. */
  error?: string;
  locale: string;
  text: ImageFieldText;
}) => {
  const id = useId();
  const [problem, setProblem] = useState<ImageProblem>();
  const file = value.kind === 'new' ? value.file : undefined;
  // The new file, previewed from the browser's memory, and released once it isn't shown.
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : undefined), [file]);
  useEffect(
    () => () => {
      if (preview) {
        URL.revokeObjectURL(preview);
      }
    },
    [preview],
  );
  const shown = value.kind === 'new' ? preview : value.kind === 'keep' ? current : null;
  const message = problem ? text.problems[problem] : error;
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  const statusId = `${id}-status`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, statusId, message ? errorId : null]
    .filter(Boolean)
    .join(' ');

  const accept = async (files: File[]) => {
    const [picked] = files;
    if (!picked) {
      return;
    }
    const sides = await readSides(picked);
    if (!sides) {
      setProblem('unreadable');
      return;
    }
    if (sides.width > MAX_IMAGE_SIDE || sides.height > MAX_IMAGE_SIDE) {
      setProblem('dimensions');
      return;
    }
    setProblem(undefined);
    onChange({ kind: 'new', file: picked });
  };
  const reject = ({ files }: FileUploadFileRejectDetails) => {
    const errors = files.flatMap((rejection) => rejection.errors);
    setProblem(errors.includes('FILE_TOO_LARGE') ? 'size' : 'type');
  };

  return (
    <div className={styles.field}>
      <span id={labelId} className={styles.label}>
        {label}
        {optional ? <span className={styles.optional}> ({optional})</span> : null}
      </span>
      {hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      <FileUpload.Root
        accept={[...IMAGE_TYPES]}
        maxFiles={1}
        maxFileSize={MAX_IMAGE_BYTES}
        // Held by the form, not here: each pick is a new one, never "too many files".
        acceptedFiles={[]}
        onFileAccept={({ files }) => void accept(files)}
        onFileReject={reject}
        translations={{ dropzone: label }}
      >
        <FileUpload.Dropzone
          disableClick
          className={styles.dropzone}
          role="group"
          aria-labelledby={labelId}
          aria-describedby={describedBy}
          aria-label={undefined}
          data-invalid={message ? '' : undefined}
        >
          {shown ? (
            <div className={styles.imageBox}>
              {/* A local preview or the API's members-only image: nothing for next/image to do. */}
              {/* oxlint-disable-next-line next/no-img-element */}
              <img src={shown} alt={alt} />
            </div>
          ) : (
            <span>{text.drop}</span>
          )}
          <p id={statusId} className={styles.hint} aria-live="polite">
            {value.kind === 'new'
              ? // One pass, by function: a file's name is never read as a pattern or a placeholder.
                text.chosen.replace(/\{(name|size)\}/gu, (_, key: string) =>
                  key === 'name' ? value.file.name : fileSize(value.file.size, locale),
                )
              : value.kind === 'remove'
                ? text.removing
                : shown
                  ? ''
                  : text.none}
          </p>
          <div className={styles.buttonRow}>
            <FileUpload.Trigger className={styles.secondaryButton}>
              {shown ? text.replace : text.choose}
            </FileUpload.Trigger>
            {shown ? (
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => {
                  setProblem(undefined);
                  onChange(current ? { kind: 'remove' } : { kind: 'keep' });
                }}
              >
                {text.remove}
              </button>
            ) : null}
            {value.kind !== 'keep' && current ? (
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => {
                  setProblem(undefined);
                  onChange({ kind: 'keep' });
                }}
              >
                {text.undo}
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
