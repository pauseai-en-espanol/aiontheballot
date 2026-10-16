import { describe, expect, it } from 'vitest';

import { localizedInput } from './localized-input.js';

describe('localizedInput', () => {
  it('keeps the text of every enabled language, as typed, and drops blank ones', () => {
    expect(localizedInput({ es: ' Texto de ejemplo ', en: '  ' }, ['es', 'en'])).toEqual({
      es: ' Texto de ejemplo ',
    });
  });

  it('is empty when nothing is left', () => {
    expect(localizedInput({ es: '', en: '\n' }, ['es', 'en'])).toBe('empty');
    expect(localizedInput({}, ['es'])).toBe('empty');
  });

  it("refuses a language the tenant doesn't enable, and anything but text", () => {
    expect(localizedInput({ es: 'Texto', ca: 'Text' }, ['es'])).toBe('invalid');
    expect(localizedInput({ es: 3 }, ['es'])).toBe('invalid');
  });
});
