import type { Metadata, Viewport } from 'next';
import type { PropsWithChildren } from 'react';

import { connection } from 'next/server';

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

const RootLayout = ({ children }: Readonly<PropsWithChildren>) => (
  <html lang="es">
    <body>{children}</body>
  </html>
);

export default RootLayout;
