import { Fragment, type ReactNode } from 'react';

import { messageParts } from '../message-parts';

interface MessageProps<K extends string> {
  /** The message, formatted with the values it is given. */
  format: (values: Record<K, string>) => string;
  /** The element in each value's place. */
  parts: Record<K, ReactNode>;
}

/** A translated message with elements in place of some of its values (`messageParts`). */
export const Message = <K extends string>({ format, parts }: MessageProps<K>) => (
  <>
    {messageParts(format, Object.keys(parts) as K[]).map((piece, index) => (
      <Fragment key={index}>{typeof piece === 'string' ? piece : parts[piece.part]}</Fragment>
    ))}
  </>
);

/** Localized content in its own language, which may not be the page's (`localText`). */
export const InLanguage = ({ text }: { text: { text: string; lang: string } }) => (
  <span lang={text.lang}>{text.text}</span>
);
