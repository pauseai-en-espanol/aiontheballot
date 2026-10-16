'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useTransition } from 'react';

import * as styles from './styles';

/**
 * The admin's language switch (editorial workflow §2.7), offering each other language named in itself and marked as
 * written in it. A plain form, so it works before scripts load: it posts, and the page comes back in the language
 * chosen (its path only; no admin page reads a query). With scripts, it posts in the background and the page redraws
 * in place, so what was typed stays, and focus moves to the language now in use, where the button pressed was.
 *
 * When the background post fails, the plain form posts after all, so the browser shows what went wrong. Not offered,
 * nor its footer, on `hiddenOn`: pages that show something once (backup codes), which a reload would lose.
 */
export const LanguageSwitch = ({
  label,
  currentLabel,
  current,
  languages,
  hiddenOn,
}: {
  label: string;
  /** Read after the language in use, in the page's language: "current". */
  currentLabel: string;
  current: string;
  languages: { code: string; name: string }[];
  hiddenOn: readonly string[];
}) => {
  const pathname = usePathname();
  const router = useRouter();
  const labelId = useId();
  const form = useRef<HTMLFormElement>(null);
  // The switch in progress, so focus moves only when its page comes back in its language, never on a later redraw.
  const switching = useRef<{ locale: string; path: string } | null>(null);
  // Set to post the plain form after all, when the background post fails, so the browser shows what went wrong.
  const native = useRef(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (pending) {
      return;
    }
    const target = switching.current;
    switching.current = null;
    if (target?.locale === current && target.path === pathname) {
      form.current?.querySelector<HTMLElement>('[aria-current]')?.focus();
    }
  }, [pending, current, pathname]);

  if (hiddenOn.includes(pathname)) {
    return null;
  }
  return (
    <footer className={styles.footer}>
      <form
        ref={form}
        className={styles.languageSwitch}
        method="post"
        action="/locale"
        aria-labelledby={labelId}
        onSubmit={(event) => {
          const { submitter } = event.nativeEvent as SubmitEvent;
          if (native.current || !(submitter instanceof HTMLButtonElement)) {
            return;
          }
          event.preventDefault();
          const fallBack = () => {
            native.current = true;
            form.current?.requestSubmit(submitter);
          };
          const body = new URLSearchParams({ back: pathname, locale: submitter.value });
          fetch('/locale', { method: 'POST', body, redirect: 'manual' })
            .then((answer) => {
              if (answer.type !== 'opaqueredirect') {
                fallBack();
                return;
              }
              switching.current = { locale: submitter.value, path: pathname };
              startTransition(() => router.refresh());
            })
            .catch(fallBack);
        }}
      >
        <input type="hidden" name="back" value={pathname} />
        <span id={labelId} className={styles.muted}>
          {label}
        </span>
        {languages.map((language) =>
          language.code === current ? (
            <strong key={language.code} tabIndex={-1} aria-current="true">
              <span lang={language.code}>{language.name}</span>
              <span className={styles.visuallyHidden}> ({currentLabel})</span>
            </strong>
          ) : (
            <button
              key={language.code}
              className={styles.textButton}
              type="submit"
              name="locale"
              value={language.code}
              lang={language.code}
            >
              {language.name}
            </button>
          ),
        )}
      </form>
    </footer>
  );
};
