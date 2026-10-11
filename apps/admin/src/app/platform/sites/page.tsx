import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getSites } from '@/data';
import { getLocale } from '@/locale';
import { siteName } from '@/localized';
import { Lang } from '@/ui/Lang';
import * as styles from '@/ui/styles';

export const generateMetadata = async (): Promise<Metadata> => ({
  title: getTranslator(await getLocale())('admin.platformSites.title'),
});

/** Every site, on or off, with its addresses (PLAN R129). */
const SitesPage = async () => {
  const found = await getSites();
  if (!found) {
    notFound();
  }
  const locale = await getLocale();
  const t = getTranslator(locale);
  return (
    <>
      <h1 className={styles.h1}>{t('admin.platformSites.title')}</h1>
      <p className={styles.text}>{t('admin.platformSites.intro')}</p>
      <p>
        <Link className={styles.link} href="/platform/sites/new">
          {t('admin.platformSites.new')}
        </Link>
      </p>
      {found.sites.length === 0 ? (
        <p className={styles.text}>{t('admin.platformSites.none')}</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption>{t('admin.platformSites.caption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('admin.platformSites.name')}</th>
                <th scope="col">{t('admin.platformSites.country')}</th>
                <th scope="col">{t('admin.platformSites.state')}</th>
                <th scope="col">{t('admin.platformSites.hostnames')}</th>
              </tr>
            </thead>
            <tbody>
              {found.sites.map((site) => (
                <tr key={site.slug}>
                  <th scope="row">
                    <Link
                      className={styles.link}
                      href={`/platform/sites/${encodeURIComponent(site.slug)}`}
                    >
                      <Lang value={siteName(site, locale)} page={locale} />
                    </Link>{' '}
                    <span className={styles.muted}>({site.slug})</span>
                  </th>
                  <td>{site.countryCode}</td>
                  <td>
                    {site.active ? t('admin.platformSites.on') : t('admin.platformSites.off')}
                  </td>
                  <td>
                    {site.hostnames.length === 0 ? (
                      <span className={styles.muted}>{t('admin.platformSites.noHostnames')}</span>
                    ) : (
                      <ul className={styles.list}>
                        {site.hostnames.map((hostname) => (
                          <li key={hostname.hostname}>
                            {hostname.hostname}
                            {hostname.canonical ? ` (${t('admin.platformSites.canonical')})` : ''}
                            {hostname.retired ? ` (${t('admin.platformSites.retired')})` : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};

export default SitesPage;
