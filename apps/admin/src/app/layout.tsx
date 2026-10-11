import type { Metadata, Viewport } from 'next';
import type { PropsWithChildren } from 'react';

import { connection } from 'next/server';

import { getLocale } from '@/locale';

import './globals.css';

// Names come from configuration, never from code (CLAUDE.md). Without connection(), Next prerenders this at build
// time and the title would come from the build environment, not the deployment's. Pages add their own title before
// the name. The admin is never for search engines.
export const generateMetadata = async (): Promise<Metadata> => {
  await connection();
  const name = process.env.PLATFORM_NAME;
  return {
    title: name ? { default: name, template: `%s · ${name}` } : undefined,
    robots: { index: false, follow: false },
  };
};

// Zoom stays enabled: WCAG 2.2 AA requires text to be resizable.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

// The language the browser asks for (editorial workflow §2.7), so screen readers read the page in it.
const RootLayout = async ({ children }: Readonly<PropsWithChildren>) => (
  <html lang={await getLocale()}>
    <body>{children}</body>
  </html>
);

export default RootLayout;
