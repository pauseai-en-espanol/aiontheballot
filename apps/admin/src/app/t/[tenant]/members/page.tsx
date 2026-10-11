import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import { notFound } from 'next/navigation';

import { getMembers, getTenant, mayAct } from '@/data';
import { getLocale } from '@/locale';
import { siteName } from '@/localized';
import { MembersTable } from '@/members/MembersTable';
import { requireStage } from '@/session';
import * as styles from '@/ui/styles';
import { roleNames, template, writeErrors } from '@/ui/text';

type Params = { params: Promise<{ tenant: string }> };

export const generateMetadata = async ({ params }: Params): Promise<Metadata> => {
  const overview = await getTenant((await params).tenant);
  const locale = await getLocale();
  const t = getTranslator(locale);
  return {
    title: overview
      ? `${t('admin.members.title')} · ${siteName(overview.tenant, locale).text}`
      : t('admin.notFound.title'),
  };
};

/** Who has access to the tenant, and with which roles (editorial workflow A7). Invitations wait for D10. */
const MembersPage = async ({ params }: Params) => {
  const { user } = await requireStage('signed-in');
  const { tenant: slug } = await params;
  const [overview, list] = await Promise.all([getTenant(slug), getMembers(slug)]);
  if (!overview || !list) {
    notFound();
  }
  const locale = await getLocale();
  const t = getTranslator(locale);
  return (
    <>
      <h1 className={styles.h1}>{t('admin.members.title')}</h1>
      <p className={styles.text}>{t('admin.members.intro')}</p>
      {mayAct(overview, 'country_admin') ? (
        <p className={styles.text}>{t('admin.members.manageIntro')}</p>
      ) : null}
      <MembersTable
        tenant={overview.tenant.slug}
        selfId={user?.id ?? ''}
        platformAdmin={overview.platformAdmin}
        locale={locale}
        members={list.members}
        canManage={list.canManage}
        emailsShown={list.emailsShown}
        text={{
          caption: t('admin.members.tableLabel', { site: siteName(overview.tenant, locale).text }),
          name: t('admin.members.name'),
          email: t('admin.members.email'),
          roles: t('admin.members.roles'),
          roleNames: roleNames(t),
          unknownAccount: t('admin.members.unknownAccount'),
          you: t('admin.members.you'),
          remove: t('admin.members.remove'),
          removeLabel: template(t, 'admin.members.removeLabel'),
          confirmBody: template(t, 'admin.members.confirmBody'),
          confirmSelf: template(t, 'admin.members.confirmSelf'),
          removed: template(t, 'admin.members.removed'),
          addLabel: template(t, 'admin.members.addLabel'),
          added: template(t, 'admin.members.added'),
          onlyCountryAdmin: t('admin.members.onlyCountryAdmin'),
          confirmTitle: t('admin.members.confirmTitle'),
          confirm: t('admin.members.confirm'),
          cancel: t('admin.members.cancel'),
          add: t('admin.members.add'),
          errors: writeErrors(t),
        }}
      />
    </>
  );
};

export default MembersPage;
