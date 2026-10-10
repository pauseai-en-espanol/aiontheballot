import base from '@slango.configs/vitest/default';
import { defineConfig, mergeConfig } from 'vitest/config';

// The API's data functions against aiontheballot_test, which @aiontheballot/db's database tests rebuild and fill with
// the matrix fixtures first (turbo runs them before these). Each test rolls back what it writes.
export default mergeConfig(
  base,
  defineConfig({ test: { include: ['tests/**/*.spec.ts'], fileParallelism: false } }),
);
