import type { Metadata, Viewport } from 'next';
import type { PropsWithChildren } from 'react';

import { getTranslator, LOCALE_NAMES, LOCALES } from '@aiontheballot/i18n/messages';
import { connection } from 'next/server';

import { getLocale } from '@/locale';
import { LanguageSwitch } from '@/ui/LanguageSwitch';

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

// The language chosen with the switch, else the browser's (editorial workflow §2.7), so screen readers read the page in
// it. The switch sits at the end of every page but enrolment, whose secret and backup codes a reload would lose.
const NO_SWITCH = ['/two-factor/enrol'];

const RootLayout = async ({ children }: Readonly<PropsWithChildren>) => {
  const locale = await getLocale();
  const t = getTranslator(locale);
  return (
    <html lang={locale}>
      <body>
        {children}
        <LanguageSwitch
          label={t('admin.language')}
          currentLabel={t('admin.shell.current')}
          current={locale}
          languages={LOCALES.map((code) => ({ code, name: LOCALE_NAMES[code] }))}
          hiddenOn={NO_SWITCH}
        />
      </body>
    </html>
  );
};

export default RootLayout;
