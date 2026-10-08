import type { Metadata, Viewport } from 'next';
import type { PropsWithChildren } from 'react';

import './globals.css';

// Names come from configuration, never from code (CLAUDE.md). Read at runtime, not inlined at build.
export const generateMetadata = (): Metadata => ({
  title: process.env.PLATFORM_NAME,
});

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
