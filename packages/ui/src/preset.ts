import { definePreset, type Preset } from '@pandacss/dev';

/**
 * The shared Panda preset for apps/web and apps/admin (ADR-0003 §5). Tokens and recipes live here, never in an app.
 * The fixed rating language and tenant theming (CSS variables behind semantic tokens) are added in M3.
 */
export const ballotPreset: Preset = definePreset({
  name: '@ballot/ui',
  theme: {
    extend: {
      tokens: {
        fonts: {
          body: { value: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
          mono: { value: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' },
        },
      },
    },
  },
});
