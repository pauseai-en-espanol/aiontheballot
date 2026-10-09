import base from '@slango.configs/vitest/default';
import { defineConfig, mergeConfig } from 'vitest/config';

// Database tests: rebuild aiontheballot_test from the migrations once, then run serially against it.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ['tests/**/*.spec.ts'],
      globalSetup: ['./tests/global-setup.ts'],
      fileParallelism: false,
    },
  }),
);
