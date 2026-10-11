'use client';

import { Menu } from '@ark-ui/react/menu';
import { Portal } from '@ark-ui/react/portal';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import type { InLanguage } from '@/localized';

import * as styles from '@/ui/styles';

export interface SiteChoice {
  slug: string;
  name: InLanguage;
}

/**
 * Opens another site the user may open (editorial workflow A6), or the list of them all: a menu of links (Ark UI, so
 * keyboard-complete), each followed by the router. The current site is marked in words as well as by
 * `aria-current`.
 */
export const SiteSwitcher = ({
  current,
  sites,
  page,
  text,
}: {
  current: string;
  sites: SiteChoice[];
  page: string;
  text: { switchSite: string; allSites: string; current: string };
}) => {
  const router = useRouter();
  return (
    <Menu.Root navigate={({ href }) => router.push(href)}>
      <Menu.Trigger className={styles.secondaryButton}>
        {text.switchSite} <span aria-hidden="true">▾</span>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content className={styles.menu}>
            {sites.map((site) => (
              <Menu.Item key={site.slug} value={`site:${site.slug}`} asChild>
                <Link
                  className={styles.menuItem}
                  href={`/t/${site.slug}`}
                  aria-current={site.slug === current ? 'page' : undefined}
                >
                  <span lang={site.name.lang === page ? undefined : site.name.lang}>
                    {site.name.text}
                  </span>
                  {site.slug === current ? ` (${text.current})` : null}
                </Link>
              </Menu.Item>
            ))}
            <Menu.Separator className={styles.menuSeparator} />
            <Menu.Item value="all" asChild>
              <Link className={styles.menuItem} href="/">
                {text.allSites}
              </Link>
            </Menu.Item>
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
};
