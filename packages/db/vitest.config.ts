import base from '@slango.configs/vitest/default';
import { defineConfig, mergeConfig } from 'vitest/config';

// Unit tests only: no database needed.
export default mergeConfig(base, defineConfig({ test: { include: ['src/**/*.spec.ts'] } }));
