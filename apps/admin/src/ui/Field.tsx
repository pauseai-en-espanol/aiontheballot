'use client';

import type { ReactNode } from 'react';

import { Field as ArkField } from '@ark-ui/react/field';

import * as styles from './styles';

/**
 * A form's field (admin forms §1.2), on Ark's `Field`: its label, a hint, "(optional)" where it may be left empty, the
 * control (`Field.Input`, `Field.Textarea` or `Field.Select`, which take their ids and descriptions from here), and
 * its own error under it once a submit found one, marked in words and a sign. Forms using it are `noValidate`: the
 * page's language says what is wrong, never the browser's bubbles, and an empty required field doesn't look wrong
 * before anyone has tried to save.
 */
export const Field = ({
  label,
  hint,
  optional,
  error,
  required,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  /** "(optional)", in the page's language, for a field that may be left empty. */
  optional?: string;
  /** What is wrong with it, after a submit; none while it's fine. */
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) => (
  <ArkField.Root
    className={className ? `${styles.field} ${className}` : styles.field}
    invalid={error !== undefined}
    required={required}
  >
    <ArkField.Label className={styles.label}>
      {label}
      {optional ? <span className={styles.optional}> ({optional})</span> : null}
    </ArkField.Label>
    {hint ? <ArkField.HelperText className={styles.hint}>{hint}</ArkField.HelperText> : null}
    {children}
    <ArkField.ErrorText className={styles.fieldError}>
      <span aria-hidden="true">⚠</span>
      <span>{error}</span>
    </ArkField.ErrorText>
  </ArkField.Root>
);

export const FieldInput = ArkField.Input;
export const FieldTextarea = ArkField.Textarea;
export const FieldSelect = ArkField.Select;
