import preset from '@slango.configs/oxlint/typescript-next.js';
import { defineConfig } from 'oxlint';

export default defineConfig({
  extends: [preset],
  ignorePatterns: ['styled-system/**', 'next-env.d.ts'],
});
