import { describe, expect, it } from 'vitest';

import { refusedField } from './refused-field';

const BODY = {
  legalName: 'Organización de Ejemplo',
  displayName: { es: 'Ejemplo' },
  isPauseaiChapter: true,
};

describe('refusedField', () => {
  it('points at a blank legal name first, then a name blank in every language', () => {
    expect(refusedField({ ...BODY, legalName: '   ' })).toBe('legal_name');
    expect(refusedField({ ...BODY, legalName: '', displayName: { es: '' } })).toBe('legal_name');
    expect(refusedField({ ...BODY, displayName: { es: ' ', en: '' } })).toBe('localized_check');
    expect(refusedField({ ...BODY, displayName: {} })).toBe('localized_check');
  });

  it('blames the PauseAI chapter only when it is no longer one', () => {
    expect(refusedField({ ...BODY, isPauseaiChapter: false })).toBe('pauseai');
    expect(refusedField(BODY)).toBeUndefined();
  });
});
