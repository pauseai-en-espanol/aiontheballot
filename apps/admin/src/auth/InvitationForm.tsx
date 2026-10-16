'use client';

import { Field } from '@ark-ui/react/field';
import Link from 'next/link';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import { fill } from '@/fill';

import { describedBy, formText, siteNameLanguage } from './client';
import * as styles from './styles';

export interface InvitationText {
  checking: string;
  missing: string;
  invalid: string;
  offer: string;
  offerAnySite: string;
  roles: Record<'country_admin' | 'editor' | 'reviewer', string>;
  newAccount: string;
  name: string;
  nameHint: string;
  password: string;
  passwordHint: string;
  confirm: string;
  mismatch: string;
  create: string;
  created: string;
  signIn: string;
  existing: string;
  accept: string;
  accepted: string;
  toAdmin: string;
  otherAccount: string;
  failed: string;
  limit: string;
  nameMissing: string;
}

interface Offer {
  email: string;
  role: 'country_admin' | 'editor' | 'reviewer';
  /**
   * The site it invites to: its name in its languages, and its main one (PLAN R199). Absent from an API older than
   * that, for the minutes a release rolls out (the review of R199).
   */
  site?: { name: Readonly<Record<string, string>>; locale: string };
  account: boolean;
  session: 'none' | 'same' | 'other';
}

type View =
  | { kind: 'checking' }
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'offer'; offer: Offer }
  | { kind: 'done'; created: boolean };

const ERROR_ID = 'invitation-error';
/** At least this long, and at most that (the API's and Better Auth's rule, editorial workflow A5.1). */
const MIN_LENGTH = 12;
const MAX_LENGTH = 128;

/** The link's token, from the fragment (`#token=…`), which no server ever sees (PLAN R114, as R93's). */
const readToken = (): string | null =>
  new URLSearchParams(window.location.hash.slice(1)).get('token') || null;

const post = async (path: string, body: object) => {
  try {
    const response = await fetch(`/api/invitations/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const parsed = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: response.status, body: parsed };
  } catch {
    return { status: 0, body: {} };
  }
};

/**
 * Accepting an invitation (editorial workflow A3): the link's token says what is offered. Without an account for the
 * invited address, the person chooses a name and a password, and the account is made and the invitation accepted at
 * once; then they sign in and set up their second factor. With an account, they sign in first and accept here. The
 * token leaves the address bar as soon as it is read.
 */
export const InvitationForm = ({
  text,
  locale,
}: {
  text: InvitationText;
  /** The page's language, which the site's name is shown in when it has one in it. */
  locale: string;
}) => {
  const [token] = useState(readToken);
  const [view, setView] = useState<View>(token ? { kind: 'checking' } : { kind: 'missing' });
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const message = useRef<HTMLParagraphElement>(null);
  // Too many lookups from here: said in the page's words when it renders, so the lookup never depends on them.
  const [limited, setLimited] = useState(false);

  useEffect(() => {
    if (!token) {
      return undefined;
    }
    window.history.replaceState(null, '', window.location.pathname);
    let live = true;
    void post('lookup', { token }).then(({ status, body }) => {
      if (!live) {
        return;
      }
      if (status === 200) {
        setView({ kind: 'offer', offer: body as unknown as Offer });
      } else {
        setView({ kind: 'invalid' });
        setLimited(status === 429);
      }
    });
    return () => {
      live = false;
    };
  }, [token]);

  // Where the page lands after a change it didn't make by itself: the result's heading, or the refusal's words.
  useEffect(() => {
    if (view.kind === 'done') {
      heading.current?.focus();
    } else if (view.kind === 'invalid') {
      message.current?.focus();
    }
  }, [view.kind]);

  const accept = async (body: object) => {
    if (pending || !token) {
      return;
    }
    setPending(true);
    setError(undefined);
    const answer = await post('accept', { token, ...body });
    setPending(false);
    if (answer.status === 200 || answer.status === 201) {
      setView({ kind: 'done', created: answer.status === 201 });
    } else if (answer.status === 404) {
      setView({ kind: 'invalid' });
    } else if (answer.status === 409) {
      setError(answer.body.error === 'otherAccount' ? text.otherAccount : text.existing);
    } else if (answer.status === 400 && answer.body.error === 'password') {
      setError(text.passwordHint);
    } else if (answer.status === 400 && answer.body.error === 'name') {
      setError(text.nameMissing);
    } else {
      setError(answer.status === 429 ? text.limit : text.failed);
    }
  };

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const password = formText(form, 'password');
    if (password !== formText(form, 'confirm')) {
      setError(text.mismatch);
      return;
    }
    await accept({ name: formText(form, 'name'), password });
  };

  const alert = (
    <div id={ERROR_ID} role="alert">
      {error ? (
        <p className={styles.alert}>
          <span aria-hidden="true">⚠ </span>
          {error}
        </p>
      ) : null}
    </div>
  );

  if (view.kind === 'checking') {
    return (
      <p role="status" className={styles.text}>
        {text.checking}
      </p>
    );
  }
  if (view.kind === 'missing') {
    return <p className={styles.text}>{text.missing}</p>;
  }
  if (view.kind === 'invalid') {
    return (
      <p ref={message} tabIndex={-1} role="status" className={styles.text}>
        {limited ? text.limit : (error ?? text.invalid)}
      </p>
    );
  }
  if (view.kind === 'done') {
    return (
      <div className={styles.form}>
        <h2 ref={heading} tabIndex={-1} className={styles.subheading}>
          {view.created ? text.created : text.accepted}
        </h2>
        <Link className={styles.link} href={view.created ? '/sign-in' : '/'}>
          {view.created ? text.signIn : text.toAdmin}
        </Link>
      </div>
    );
  }

  const { offer } = view;
  const words = { email: offer.email, role: text.roles[offer.role] };
  // Marked with the language it is in when that isn't the page's (WCAG 3.1.2).
  const siteName = offer.site?.name;
  const siteLang = siteNameLanguage(siteName, locale, offer.site?.locale);
  const [before = '', after = ''] = text.offer.split('{site}');
  const offered = (
    <p className={styles.text}>
      {siteLang === undefined ? (
        fill(text.offerAnySite, words)
      ) : (
        <>
          {fill(before, words)}
          <span lang={siteLang === locale ? undefined : siteLang}>{siteName?.[siteLang]}</span>
          {fill(after, words)}
        </>
      )}
    </p>
  );
  // Signed in as someone else: whatever the invited address has, this account can't take it.
  if (offer.session === 'other') {
    return (
      <div className={styles.form}>
        {offered}
        <p className={styles.text}>{text.otherAccount}</p>
      </div>
    );
  }
  if (offer.account) {
    if (offer.session === 'same') {
      return (
        <div className={styles.form}>
          {offered}
          {alert}
          <button
            className={styles.button}
            type="button"
            aria-disabled={pending}
            aria-describedby={error ? ERROR_ID : undefined}
            onClick={() => void accept({})}
          >
            {text.accept}
          </button>
        </div>
      );
    }
    return (
      <div className={styles.form}>
        {offered}
        <p className={styles.text}>{text.existing}</p>
        <Link className={styles.link} href="/sign-in">
          {text.signIn}
        </Link>
      </div>
    );
  }
  return (
    <form className={styles.form} onSubmit={create}>
      {offered}
      <p className={styles.text}>{text.newAccount}</p>
      <Field.Root className={styles.field} required>
        <Field.Label className={styles.label}>{text.name}</Field.Label>
        <Field.HelperText id="invitation-name-hint" className={styles.hint}>
          {text.nameHint}
        </Field.HelperText>
        <Field.Input
          className={styles.input}
          name="name"
          autoComplete="name"
          maxLength={200}
          aria-describedby="invitation-name-hint"
        />
      </Field.Root>
      <Field.Root className={styles.field} required invalid={error === text.passwordHint}>
        <Field.Label className={styles.label}>{text.password}</Field.Label>
        <Field.HelperText id="invitation-password-hint" className={styles.hint}>
          {text.passwordHint}
        </Field.HelperText>
        <Field.Input
          className={styles.input}
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_LENGTH}
          maxLength={MAX_LENGTH}
          aria-describedby={describedBy('invitation-password-hint', error && ERROR_ID)}
        />
      </Field.Root>
      <Field.Root className={styles.field} required invalid={error === text.mismatch}>
        <Field.Label className={styles.label}>{text.confirm}</Field.Label>
        <Field.Input
          className={styles.input}
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={MIN_LENGTH}
          maxLength={MAX_LENGTH}
          aria-describedby={describedBy(error && ERROR_ID)}
        />
      </Field.Root>
      {alert}
      <button className={styles.button} type="submit" aria-disabled={pending}>
        {text.create}
      </button>
    </form>
  );
};
