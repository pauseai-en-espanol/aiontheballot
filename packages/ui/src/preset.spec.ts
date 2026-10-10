import { describe, expect, it } from 'vitest';

import { palette, roles } from './brand.js';
import { aiontheballotPreset } from './preset.js';

describe('aiontheballotPreset', () => {
  const tokens = aiontheballotPreset.theme?.extend?.tokens;

  it('is named so Panda can de-duplicate it', () => {
    expect(aiontheballotPreset.name).toBe('@aiontheballot/ui');
  });

  it('defines the shared font tokens, each falling back to the system font', () => {
    for (const name of ['display', 'body', 'numeric']) {
      expect(tokens?.fonts?.[name]?.value).toMatch(/^var\(--font-[a-z]+, system-ui\), /);
    }
    expect(tokens?.fonts).toHaveProperty('mono');
  });

  it('exposes the palette as tokens and the colour roles as semantic tokens', () => {
    expect(tokens?.colors?.brand).toMatchObject({ orange: { value: palette.orange } });
    expect(tokens?.colors?.brand).toMatchObject({ grey: { 700: { value: palette.grey[700] } } });
    expect(aiontheballotPreset.theme?.extend?.semanticTokens?.colors).toMatchObject({
      bg: { accent: { value: roles.bg.accent } },
      fg: { default: { value: roles.fg.default } },
      border: { subtle: { value: roles.border.subtle } },
    });
  });
});
