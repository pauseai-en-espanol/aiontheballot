import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { type ChangeRequest, getChanges } from '@/changes/data';
import { fieldLabels } from '@/changes/text';
import { fieldChanges } from '@/changes/values';
import { getTenant } from '@/data';
import { getElection } from '@/elections/data';
import { getLocale } from '@/locale';
import { type InLanguage, inLanguage } from '@/localized';
import { sourceKinds } from '@/sources/text';
import { ConfirmButton } from '@/ui/ConfirmButton';
import { Lang } from '@/ui/Lang';
import * as styles from '@/ui/styles';
import { writeErrors } from '@/ui/text';

type Params = { params: Promise<{ tenant: string; election: string }> };

export const generateMetadata = async (): Promise<Metadata> => ({
  title: getTranslator(await getLocale())('admin.changes.title'),
});

/**
 * An election's change requests (editorial workflow CR1): what may be proposed while it is live, then the requests
 * waiting for a decision, with approve, reject and withdraw as the user's roles allow, then the decided ones. Each says
 * what it changes, from what to what, its public note, and who proposed and decided it (members' names only, R94).
 */
const ChangesPage = async ({ params }: Params) => {
  const { tenant: slug, election: electionSlug } = await params;
  const [overview, found, data] = await Promise.all([
    getTenant(slug),
    getElection(slug, electionSlug),
    getChanges(slug, electionSlug),
  ]);
  if (!overview || !found || !data) {
    notFound();
  }
  const locale = await getLocale();
  const t = getTranslator(locale);
  const { tenant } = overview;
  const { election } = found;
  const base = `/t/${tenant.slug}/e/${election.slug}/changes`;
  const api = `/api/t/${tenant.slug}/e/${election.slug}/changes`;
  const labels = fieldLabels(t);
  const kinds = sourceKinds(t);
  const live = election.status === 'live';
  const pick = (value: unknown): InLanguage | undefined => {
    if (value === null || value === undefined || value === '') {
      return undefined;
    }
    if (Array.isArray(value)) {
      return value.length > 0
        ? {
            text: value
              .map((v) =>
                typeof v === 'string' ? (kinds[v as keyof typeof kinds] ?? v) : JSON.stringify(v),
              )
              .join(', '),
            lang: locale,
          }
        : undefined;
    }
    if (typeof value === 'object') {
      return inLanguage(value as Record<string, string>, locale, tenant.defaultLocale);
    }
    return {
      text:
        typeof value === 'string' || typeof value === 'number'
          ? String(value)
          : JSON.stringify(value),
      lang: locale,
    };
  };
  const none = { text: t('admin.changes.form.none'), lang: locale };
  const list = new Intl.ListFormat(locale, { type: 'conjunction' });
  /** What a request does, in words: "Change of name, colour and website" for a set of fields (PLAN R183). */
  const action = (change: ChangeRequest) =>
    t(`admin.changes.actions.${change.action}`, {
      field:
        change.action === 'update'
          ? list.format(
              fieldChanges(change.field, change.previousValue, change.proposedValue).map(
                ({ field }) => (labels[field] ?? field).toLocaleLowerCase(locale),
              ),
            )
          : '',
    });
  /** A value in a change's table: a logo as the image it is, anything else in words. */
  const value = (field: string, shown: unknown, alt: string) =>
    field === 'logo_file_id' && typeof shown === 'string' ? (
      // The API serves the site's images to members only, with nothing for next/image to do.
      // oxlint-disable-next-line next/no-img-element
      <img className={styles.thumb} src={`/api/t/${tenant.slug}/images/${shown}`} alt={alt} />
    ) : (
      <Lang value={pick(shown) ?? none} page={locale} />
    );
  const who = (id: string | null) =>
    (id ? data.names[id] : undefined) ?? t('admin.changes.notMember');
  const when = (instant: string | null) =>
    instant ? new Date(instant).toLocaleDateString(locale, { dateStyle: 'long' }) : '';
  const target = (change: ChangeRequest) => {
    const name =
      typeof change.targetName === 'string'
        ? { text: change.targetName, lang: locale }
        : change.targetName
          ? inLanguage(change.targetName, locale, tenant.defaultLocale)
          : undefined;
    return (
      <>
        {t(`admin.changes.kinds.${change.targetKind}`)}
        {name ? (
          <>
            {' '}
            <Lang value={name} page={locale} />
          </>
        ) : null}
      </>
    );
  };
  /** What a request's buttons act on, in words, since every card has the same buttons. */
  const summary = (change: ChangeRequest): string => {
    const name =
      typeof change.targetName === 'string'
        ? change.targetName
        : change.targetName
          ? inLanguage(change.targetName, locale, tenant.defaultLocale)?.text
          : undefined;
    return [t(`admin.changes.kinds.${change.targetKind}`), name, '·', action(change)]
      .filter(Boolean)
      .join(' ');
  };
  const item = (change: ChangeRequest) => {
    const note = inLanguage(change.publicNote, locale, tenant.defaultLocale);
    const what = summary(change);
    const own = change.proposedBy === data.you;
    const added =
      change.action === 'add' && change.proposedValue && typeof change.proposedValue === 'object'
        ? Object.entries(change.proposedValue as Record<string, unknown>)
        : [];
    return (
      <li key={change.id} className={styles.card}>
        <h4 className={styles.h3}>
          {target(change)}
          {' · '}
          {action(change)}
        </h4>
        {change.action === 'update' ? (
          <table className={styles.changeTable}>
            <thead>
              <tr>
                <th scope="col">{t('admin.changes.field')}</th>
                <th scope="col">{t('admin.changes.was')}</th>
                <th scope="col">{t('admin.changes.proposedValue')}</th>
              </tr>
            </thead>
            <tbody>
              {fieldChanges(change.field, change.previousValue, change.proposedValue).map(
                ({ field, before, after }) => (
                  <tr key={field}>
                    <th scope="row">{labels[field] ?? field}</th>
                    <td>
                      {value(field, before, `${labels[field] ?? field}: ${t('admin.changes.was')}`)}
                    </td>
                    <td>
                      {value(
                        field,
                        after,
                        `${labels[field] ?? field}: ${t('admin.changes.proposedValue')}`,
                      )}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        ) : null}
        {added.length > 0 ? (
          <dl className={styles.facts}>
            {added.map(([column, value]) => (
              <div key={column}>
                <dt>{labels[column] ?? column}</dt>
                <dd>
                  <Lang value={pick(value) ?? none} page={locale} />
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        <p className={styles.text}>
          <strong>{t('admin.changes.note')}:</strong>{' '}
          {note ? <Lang value={note} page={locale} /> : t('admin.changes.form.none')}
        </p>
        <p className={styles.hint}>
          {t('admin.changes.proposedBy', {
            name: who(change.proposedBy),
            date: when(change.proposedAt),
          })}
          {change.state !== 'pending'
            ? ` · ${t('admin.changes.decidedBy', {
                state: t(`admin.changes.states.${change.state}`),
                name: who(change.decidedBy),
                date: when(change.decidedAt),
              })}`
            : ''}
        </p>
        {change.state === 'pending' ? (
          <div className={styles.actions}>
            {data.canApprove && live && (!own || data.ownApprovals) ? (
              <ConfirmButton
                method="POST"
                path={`${api}/${change.id}/decision`}
                body={{ state: 'approved' }}
                removes
                secondary={false}
                text={{
                  button: t('admin.changes.approve'),
                  label: `${t('admin.changes.approve')}: ${what}`,
                  title: t('admin.changes.approveTitle'),
                  body: t('admin.changes.approveBody'),
                  confirm: t('admin.changes.approve'),
                  cancel: t('admin.members.cancel'),
                  done: t('admin.changes.approved'),
                  errors: writeErrors(t),
                }}
              />
            ) : null}
            {data.canReject ? (
              <ConfirmButton
                method="POST"
                path={`${api}/${change.id}/decision`}
                body={{ state: 'rejected' }}
                removes
                text={{
                  button: t('admin.changes.reject'),
                  label: `${t('admin.changes.reject')}: ${what}`,
                  title: t('admin.changes.rejectTitle'),
                  body: t('admin.changes.rejectBody'),
                  confirm: t('admin.changes.reject'),
                  cancel: t('admin.members.cancel'),
                  done: t('admin.changes.rejected'),
                  errors: writeErrors(t),
                }}
              />
            ) : null}
            {data.canPropose ? (
              <ConfirmButton
                method="DELETE"
                path={`${api}/${change.id}`}
                removes
                text={{
                  button: t('admin.changes.withdraw'),
                  label: `${t('admin.changes.withdraw')}: ${what}`,
                  title: t('admin.changes.withdrawTitle'),
                  body: t('admin.changes.withdrawBody'),
                  confirm: t('admin.changes.withdraw'),
                  cancel: t('admin.members.cancel'),
                  done: t('admin.changes.withdrawn'),
                  errors: writeErrors(t),
                }}
              />
            ) : null}
            {data.canApprove && own && !data.ownApprovals ? (
              <p className={styles.hint}>{t('admin.changes.ownNeedsOther')}</p>
            ) : null}
          </div>
        ) : null}
      </li>
    );
  };
  const pending = data.changes.filter((change) => change.state === 'pending');
  const decided = data.changes.filter((change) => change.state !== 'pending');
  return (
    <>
      <h2 className={styles.h2}>{t('admin.changes.title')}</h2>
      <p className={styles.text}>{t('admin.changes.intro')}</p>
      {live ? (
        data.canPropose ? (
          <ul className={styles.list}>
            <li>
              <Link className={styles.link} href={`${base}/new?target=election`}>
                {t('admin.changes.proposeElection')}
              </Link>
            </li>
            <li>
              <Link className={styles.link} href={`${base}/new?target=methodology`}>
                {t('admin.changes.proposeMethodology')}
              </Link>
            </li>
            <li>
              <Link className={styles.link} href={`${base}/new?target=party&action=add`}>
                {t('admin.changes.addParty')}
              </Link>
            </li>
            <li>
              <Link className={styles.link} href={`${base}/new?target=criterion&action=add`}>
                {t('admin.changes.addCriterion')}
              </Link>
            </li>
            <li>
              <Link
                className={styles.link}
                href={`${base}/new?target=methodology_reviewer&action=add`}
              >
                {t('admin.changes.addReviewer')}
              </Link>
            </li>
          </ul>
        ) : null
      ) : (
        <p className={styles.notice}>{t('admin.changes.notLive')}</p>
      )}
      <section aria-labelledby="pending" className={styles.section}>
        <h3 id="pending" className={styles.h3}>
          {t('admin.changes.pending')}
        </h3>
        {pending.length > 0 ? (
          <ul className={styles.cards}>{pending.map(item)}</ul>
        ) : (
          <p className={styles.text}>{t('admin.changes.none')}</p>
        )}
      </section>
      {decided.length > 0 ? (
        <section aria-labelledby="decided" className={styles.section}>
          <h3 id="decided" className={styles.h3}>
            {t('admin.changes.decided')}
          </h3>
          <ul className={styles.cards}>{decided.map(item)}</ul>
        </section>
      ) : null}
    </>
  );
};

export default ChangesPage;
