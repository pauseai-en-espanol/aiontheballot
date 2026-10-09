import en from './messages/en.json' with { type: 'json' };
import es from './messages/es.json' with { type: 'json' };

/**
 * UI strings. English is the source: every key lives in en.json. Spanish is mandatory: es.json is typed against
 * the shape of en.json, so a missing Spanish string fails the type check (ADR-0003 §6). Wording marked as
 * provisional in docs/PLAN.md (P6, P7) still needs the chapter's confirmation.
 *
 * This module has no dependencies, so client code can read a plain string without shipping the message formatter.
 */
export type Messages = typeof en;

export const LOCALES = ['en', 'es'] as const;
export type Locale = (typeof LOCALES)[number];

export const messages: Record<Locale, Messages> = { en, es };

export const isLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
