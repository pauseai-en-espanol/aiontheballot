import { describe, expect, it } from 'vitest';

import { aiontheballotPreset } from './preset.js';

describe('aiontheballotPreset', () => {
  it('is named so Panda can de-duplicate it', () => {
    expect(aiontheballotPreset.name).toBe('@aiontheballot/ui');
  });

  it('defines the shared font tokens', () => {
    expect(aiontheballotPreset.theme?.extend?.tokens?.fonts).toHaveProperty('body');
    expect(aiontheballotPreset.theme?.extend?.tokens?.fonts).toHaveProperty('mono');
  });
});
