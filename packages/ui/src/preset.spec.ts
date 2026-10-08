import { describe, expect, it } from 'vitest';

import { ballotPreset } from './preset.js';

describe('ballotPreset', () => {
  it('is named so Panda can de-duplicate it', () => {
    expect(ballotPreset.name).toBe('@ballot/ui');
  });

  it('defines the shared font tokens', () => {
    expect(ballotPreset.theme?.extend?.tokens?.fonts).toHaveProperty('body');
    expect(ballotPreset.theme?.extend?.tokens?.fonts).toHaveProperty('mono');
  });
});
