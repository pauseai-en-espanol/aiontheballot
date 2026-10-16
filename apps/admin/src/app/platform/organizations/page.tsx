import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getOrganizations } from '@/data';
import { getLocale } from '@/locale';
import { linkedSiteName, organizationName } from '@/localized';
import { Lang } from '@/ui/Lang';
import * as styles from '@/ui/styles';

export const generateMetadata = async (): Promise<Metadata> => ({
  title: getTranslator(await getLocale())('admin.organizations.title'),
});

/** Every organization, with the sites each runs or endorses (editorial workflow P2). */
const OrganizationsPage = async () => {
  const found = await getOrganizations();
  if (!found) {
    notFound();
  }
  const locale = await getLocale();
  const t = getTranslator(locale);
  return (
    <>
      <h1 className={styles.h1}>{t('admin.organizations.title')}</h1>
      <p className={styles.text}>{t('admin.organizations.intro')}</p>
      <p>
        <Link className={styles.link} href="/platform/organizations/new">
          {t('admin.organizations.new')}
        </Link>
      </p>
      {found.organizations.length === 0 ? (
        <p className={styles.text}>{t('admin.organizations.none')}</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption>{t('admin.organizations.caption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('admin.organizations.name')}</th>
                <th scope="col">{t('admin.organizations.legalName')}</th>
                <th scope="col">{t('admin.organizations.sites')}</th>
              </tr>
            </thead>
            <tbody>
              {found.organizations.map((organization) => (
                <tr key={organization.id}>
                  <th scope="row">
                    <Link
                      className={styles.link}
                      href={`/platform/organizations/${organization.id}`}
                    >
                      <Lang value={organizationName(organization, locale)} page={locale} />
                    </Link>
                    {organization.isPauseaiChapter ? (
                      <>
                        {' '}
                        <span className={styles.tag}>{t('admin.organizations.pauseai')}</span>
                      </>
                    ) : null}
                  </th>
                  <td>{organization.legalName}</td>
                  <td>
                    {organization.tenants.length === 0 ? (
                      <span className={styles.muted}>{t('admin.organizations.noSites')}</span>
                    ) : (
                      <ul className={styles.list}>
                        {organization.tenants.map((site) => (
                          <li key={site.slug}>
                            <Lang value={linkedSiteName(site, locale)} page={locale} /> (
                            {t(`admin.organizations.roles.${site.role}`)})
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

export default OrganizationsPage;
