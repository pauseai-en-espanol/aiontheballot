import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import { notFound } from 'next/navigation';

import { getInvitations, getMembers, getTenant, mayAct } from '@/data';
import { InviteForm } from '@/invitations/InviteForm';
import { getLocale } from '@/locale';
import { siteName } from '@/localized';
import { MembersTable } from '@/members/MembersTable';
import { requireStage } from '@/session';
import { ConfirmButton } from '@/ui/ConfirmButton';
import * as styles from '@/ui/styles';
import { problemText, roleNames, template, writeErrors } from '@/ui/text';

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

/**
 * Who has access to the tenant, and with which roles (editorial workflow A7), and, for its country admins and platform
 * admins, its invitations (A2).
 */
const MembersPage = async ({ params }: Params) => {
  const { user } = await requireStage('signed-in');
  const { tenant: slug } = await params;
  const [overview, list, invited] = await Promise.all([
    getTenant(slug),
    getMembers(slug),
    getInvitations(slug),
  ]);
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
        members={list.members}
        canManage={list.canManage}
        emailsShown={list.emailsShown}
        resetReady={list.resetReady === true}
        text={{
          caption: t('admin.members.tableLabel', { site: siteName(overview.tenant, locale).text }),
          name: t('admin.members.name'),
          email: t('admin.members.email'),
          roles: t('admin.members.roles'),
          roleNames: roleNames(t),
          roleHints: {
            country_admin: t('admin.members.roleHints.country_admin'),
            editor: t('admin.members.roleHints.editor'),
            reviewer: t('admin.members.roleHints.reviewer'),
          },
          unknownAccount: t('admin.members.unknownAccount'),
          you: t('admin.members.you'),
          onlyCountryAdmin: t('admin.members.onlyCountryAdmin'),
          cancel: t('admin.members.cancel'),
          actions: t('admin.members.actions'),
          editRoles: {
            button: t('admin.members.editRoles'),
            label: template(t, 'admin.members.editRolesLabel'),
            title: template(t, 'admin.members.rolesTitle'),
            intro: template(t, 'admin.members.rolesIntro'),
            save: t('admin.members.saveRoles'),
            saved: template(t, 'admin.members.rolesSaved'),
            loseAccess: template(t, 'admin.members.loseAccess'),
            loseAccessSelf: t('admin.members.loseAccessSelf'),
          },
          reset: {
            button: t('admin.members.resetPassword'),
            label: template(t, 'admin.members.resetLabel'),
            title: t('admin.members.resetTitle'),
            body: template(t, 'admin.members.resetBody'),
            confirm: t('admin.members.resetConfirm'),
            done: template(t, 'admin.members.resetSent'),
          },
          errors: writeErrors(t),
        }}
      />
      {invited?.canInvite ? (
        <section aria-labelledby="invitations" className={styles.section}>
          <h2 id="invitations" className={styles.h2}>
            {t('admin.invitations.title')}
          </h2>
          <p className={styles.text}>{t('admin.invitations.intro', { days: invited.days })}</p>
          {invited.invitations.length === 0 ? (
            <p className={styles.text}>{t('admin.invitations.none')}</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <caption>{t('admin.invitations.caption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('admin.invitations.email')}</th>
                    <th scope="col" className={styles.wideColumn}>
                      {t('admin.invitations.role')}
                    </th>
                    <th scope="col" className={styles.wideColumn}>
                      {t('admin.invitations.state')}
                    </th>
                    <th scope="col" className={styles.wideColumn}>
                      {t('admin.invitations.expires')}
                    </th>
                    <th scope="col">
                      <span className={styles.visuallyHidden}>
                        {t('admin.invitations.actions')}
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {invited.invitations.map((invitation) => {
                    const path = `/api/t/${encodeURIComponent(overview.tenant.slug)}/invitations/${invitation.id}`;
                    return (
                      <tr key={invitation.id}>
                        <th scope="row" className={styles.breakAnywhere}>
                          {invitation.email}
                          {/* On a phone the role, state and expiry columns are hidden, and they are here instead
                              (admin forms §2, as the members' table, R182). */}
                          <span className={styles.narrowOnly}>
                            {roleNames(t)[invitation.role]} ·{' '}
                            {t(`admin.invitations.states.${invitation.state}`)} ·{' '}
                            {t('admin.invitations.expires')}{' '}
                            {t('admin.cells.on', { date: new Date(invitation.expiresAt) })}
                          </span>
                        </th>
                        <td className={styles.wideColumn}>{roleNames(t)[invitation.role]}</td>
                        <td className={styles.wideColumn}>
                          {t(`admin.invitations.states.${invitation.state}`)}
                        </td>
                        <td className={styles.wideColumn}>
                          {t('admin.cells.on', { date: new Date(invitation.expiresAt) })}
                        </td>
                        <td>
                          {invitation.state === 'pending' ? (
                            <ConfirmButton
                              method="POST"
                              path={`${path}/revoke`}
                              text={{
                                button: t('admin.invitations.revoke'),
                                label: `${t('admin.invitations.revoke')}: ${invitation.email}`,
                                title: t('admin.invitations.revoke'),
                                body: invitation.email,
                                confirm: t('admin.invitations.revoke'),
                                cancel: t('admin.members.cancel'),
                                done: t('admin.invitations.revoked'),
                                errors: writeErrors(t),
                              }}
                            />
                          ) : (
                            <ConfirmButton
                              method="DELETE"
                              path={path}
                              removes
                              text={{
                                button: t('admin.invitations.delete'),
                                label: `${t('admin.invitations.delete')}: ${invitation.email}`,
                                title: t('admin.invitations.deleteTitle'),
                                body: t('admin.invitations.deleteBody'),
                                confirm: t('admin.invitations.delete'),
                                cancel: t('admin.members.cancel'),
                                done: t('admin.invitations.deleted'),
                                errors: writeErrors(t),
                              }}
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <h3 className={styles.h3}>{t('admin.invitations.invite')}</h3>
          {invited.mailReady ? (
            <InviteForm
              path={`/api/t/${encodeURIComponent(overview.tenant.slug)}/invitations`}
              // Least powerful first, editing chosen to start with (admin forms §2).
              roles={(['editor', 'reviewer', 'country_admin'] as const).map((role) => ({
                value: role,
                label: roleNames(t)[role],
                hint: t(`admin.members.roleHints.${role}`),
              }))}
              text={{
                email: t('admin.invitations.email'),
                emailHint: t('admin.invitations.emailHint'),
                role: t('admin.invitations.role'),
                send: t('admin.invitations.send'),
                sent: t('admin.invitations.sent'),
                errors: writeErrors(t),
                problems: problemText(t),
              }}
            />
          ) : (
            <p className={styles.notice}>{t('admin.invitations.noMail')}</p>
          )}
        </section>
      ) : null}
    </>
  );
};

export default MembersPage;
