import { describe, expect, it } from 'vitest';

import { getTranslator, isLocale, LOCALES, messages } from './messages.js';

const keyPaths = (value: unknown, prefix = ''): string[] =>
  value !== null && typeof value === 'object'
    ? Object.entries(value).flatMap(([key, child]) =>
        keyPaths(child, prefix ? `${prefix}.${key}` : key),
      )
    : [prefix];

describe('messages', () => {
  it('has the same keys in every locale as in English', () => {
    const source = keyPaths(messages.en).sort();
    for (const locale of LOCALES) {
      expect(keyPaths(messages[locale]).sort()).toEqual(source);
    }
  });

  it('formats the operator line in Spanish', () => {
    const t = getTranslator('es');
    expect(t('layout.initiativeOf', { operator: 'Organización Ejemplo' })).toBe(
      'Una iniciativa de Organización Ejemplo',
    );
  });

  it('formats dates for the locale', () => {
    const t = getTranslator('en');
    expect(
      t('party.programmePending', { checkedAt: new Date(Date.UTC(2030, 0, 15, 12)) }),
    ).toContain('2030');
  });

  it('keeps share descriptions short enough for link previews on phones', () => {
    // About 125 characters show. Operators' names run to about 20 (PauseAI España is 14).
    const operator = 'Organización de ej20';
    for (const locale of LOCALES) {
      const t = getTranslator(locale);
      for (const kind of ['demands', 'descriptive'] as const) {
        expect(t(`home.shareDescription.${kind}`, { operator }).length).toBeLessThanOrEqual(125);
      }
    }
  });

  it('recognises supported locales', () => {
    expect(isLocale('es')).toBe(true);
    expect(isLocale('ca')).toBe(false);
  });
});
