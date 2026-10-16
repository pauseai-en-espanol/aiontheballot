'use client';

import { useEffect, useRef, useState } from 'react';

import { Field, FieldInput } from './Field';
import { slugFrom } from './slug';
import * as styles from './styles';

/**
 * A slug (admin forms §1.5, PLAN R192), with one label everywhere. A new one follows the name as it is typed (`from`:
 * the name input's `name`, its default language's) until someone edits it; a saved one never changes by itself. Under
 * it, the public address it makes (`address`, with `{slug}` where the slug goes), when it has one.
 */
export const SlugField = ({
  name = 'slug',
  from,
  value,
  address,
  error,
  text,
}: {
  name?: string;
  from?: string;
  value?: string;
  address?: string;
  error?: string | undefined;
  text: {
    label: string;
    hint: string;
    /** With `{address}`. */
    address: string;
  };
}) => {
  const input = useRef<HTMLInputElement>(null);
  const [slug, setSlug] = useState(value ?? '');
  const [own, setOwn] = useState((value ?? '') !== '');
  useEffect(() => {
    const form = input.current?.form;
    if (!form || own || from === undefined) {
      return undefined;
    }
    const follow = (event: Event) => {
      const { target } = event;
      if (
        (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) &&
        target.name === from
      ) {
        setSlug(slugFrom(target.value));
      }
    };
    form.addEventListener('input', follow);
    return () => form.removeEventListener('input', follow);
  }, [from, own]);
  return (
    <Field label={text.label} hint={text.hint} error={error} required>
      <FieldInput
        ref={input}
        className={styles.input}
        name={name}
        value={slug}
        maxLength={63}
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          setOwn(true);
          setSlug(event.target.value);
        }}
      />
      {address !== undefined && slug.trim() !== '' ? (
        <p className={styles.hint}>
          {text.address.replace('{address}', address.replace('{slug}', slug.trim()))}
        </p>
      ) : null}
    </Field>
  );
};
