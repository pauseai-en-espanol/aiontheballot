import { useState } from 'react';

import type { Problems } from './checks';

import { useFocusFirstInvalid } from './focus';

/**
 * A form's problems, field by field (admin forms §1.2): each shown under its field after a submit, and focus moved to
 * the first, so its message is read first. The form takes `form` as its ref and is `noValidate`.
 */
export const useProblems = <F extends string>() => {
  const [problems, setProblems] = useState<Problems<F>>({});
  const { form, focusFirstInvalid } = useFocusFirstInvalid();
  /** Shows `found` in place of what was shown; whether there was any, focus then on the first. */
  const show = (found: Problems<F>): boolean => {
    setProblems(found);
    const any = Object.keys(found).length > 0;
    if (any) {
      focusFirstInvalid();
    }
    return any;
  };
  return { problems, show, form };
};
