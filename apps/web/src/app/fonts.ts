import localFont from 'next/font/local';

// PauseAI's typefaces (pauseai.info/press), self-hosted from Fontsource so no visitor's request reaches a font CDN.
// Latin only: it covers Spanish, Catalan, Basque, Galician and English. The variable names are the ones the shared
// preset's font tokens read (packages/ui/src/brand.ts). next/font only takes literal options, hence the full paths.

export const sairaCondensed = localFont({
  src: '../../node_modules/@fontsource/saira-condensed/files/saira-condensed-latin-700-normal.woff2',
  weight: '700',
  variable: '--font-display',
  display: 'swap',
});

export const robotoSlab = localFont({
  // Every face here is preloaded, so only the ones pages use: bold body text comes with the scorecard (M3).
  src: '../../node_modules/@fontsource/roboto-slab/files/roboto-slab-latin-400-normal.woff2',
  weight: '400',
  variable: '--font-body',
  display: 'swap',
});

export const montserrat = localFont({
  src: '../../node_modules/@fontsource/montserrat/files/montserrat-latin-900-normal.woff2',
  weight: '900',
  variable: '--font-numeric',
  display: 'swap',
});
