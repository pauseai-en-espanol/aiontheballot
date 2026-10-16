import { useEffect, useRef, useState } from 'react';

/**
 * Moves focus to the first field a submit marked wrong, so its error is read first (admin forms §1.2): after the
 * render that marks it (`aria-invalid`), whenever it is asked for. The form takes `form` as its ref.
 */
export const useFocusFirstInvalid = () => {
  const form = useRef<HTMLFormElement>(null);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    if (asked > 0) {
      form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }
  }, [asked]);
  return { form, focusFirstInvalid: () => setAsked((times) => times + 1) };
};
