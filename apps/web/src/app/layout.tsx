import type { Metadata, Viewport } from 'next';
import type { PropsWithChildren } from 'react';

import { isLocale } from '@aiontheballot/i18n/messages';
import { headers } from 'next/headers';
import { connection } from 'next/server';

import { SITE_LOCALE_HEADER } from '@/site-mode';

import { montserrat, robotoSlab, sairaCondensed } from './fonts';
import './globals.css';

// Names come from configuration, never from code (CLAUDE.md). Without connection(), Next prerenders this at build
// time and the title would come from the build environment, not the deployment's.
export const generateMetadata = async (): Promise<Metadata> => {
  await connection();
  return { title: process.env.PLATFORM_NAME };
};

// Zoom stays enabled: WCAG 2.2 AA requires text to be resizable.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

/** The page's language, which the routing proxy sets for every page it serves; else English, the source language. */
const RootLayout = async ({ children }: Readonly<PropsWithChildren>) => {
  const locale = (await headers()).get(SITE_LOCALE_HEADER);
  return (
    <html
      lang={isLocale(locale) ? locale : 'en'}
      className={`${sairaCondensed.variable} ${robotoSlab.variable} ${montserrat.variable}`}
    >
      <body>{children}</body>
    </html>
  );
};

export default RootLayout;
