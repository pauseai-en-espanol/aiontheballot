import { aiontheballotPreset } from '@aiontheballot/ui/preset';
import { defineConfig } from '@pandacss/dev';

export default defineConfig({
  preflight: true,
  include: ['./src/**/*.{ts,tsx}'],
  exclude: [],
  jsxFramework: 'react',
  outdir: 'styled-system',
  presets: ['@pandacss/preset-base', '@pandacss/preset-panda', aiontheballotPreset],
});
