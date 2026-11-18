import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import { notFound } from 'next/navigation';

import { getTenant } from '@/data';
import { getLocale } from '@/locale';
import { getShares, type ShareEvent } from '@/shares/data';
import * as styles from '@/ui/styles';

type Params = { params: Promise<{ tenant: string; election: string }> };

export const generateMetadata = async (): Promise<Metadata> => ({
  title: getTranslator(await getLocale())('sharesPage.title'),
});

const EVENTS: readonly ShareEvent[] = ['share', 'arrival', 'preview'];

/**
 * How the election's pages are shared (PLAN R239): clicks in the share dialog, visits through a shared link (forwards
 * included), and link previews drawn by the networks, by channel, by page and by day. Counts only: nothing is kept of
 * who shared, which every member may see.
 */
const SharesPage = async ({ params }: Params) => {
  const { tenant: slug, election } = await params;
  const [overview, shares] = await Promise.all([getTenant(slug), getShares(slug, election)]);
  if (!overview || !shares) {
    notFound();
  }
  const locale = await getLocale();
  const t = getTranslator(locale);
  const number = new Intl.NumberFormat(locale);
  const eventName = (event: ShareEvent) => t(`sharesPage.events.${event}`);
  const channelName = (channel: string) =>
    t(`sharesPage.channels.${channel as 'whatsapp'}`, {}) || channel;
  const dayName = (day: string) =>
    new Date(`${day}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  return (
    <>
      <h2 className={styles.h2}>{t('sharesPage.title')}</h2>
      <p className={styles.text}>{t('sharesPage.lead')}</p>
      {shares.since === null ? (
        <p className={styles.text}>{t('sharesPage.empty')}</p>
      ) : (
        <>
          <p className={styles.text}>
            {t('sharesPage.since', { date: new Date(`${shares.since}T12:00:00Z`) })}
          </p>
          <ul className={styles.list}>
            {EVENTS.map((event) => (
              <li key={event}>
                <strong>{number.format(shares.totals[event])}</strong> {eventName(event)} ·{' '}
                <span className={styles.muted}>{t(`sharesPage.explain.${event}`)}</span>
              </li>
            ))}
          </ul>

          <h3 className={styles.h2}>{t('sharesPage.byChannel')}</h3>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('sharesPage.channel')}</th>
                  {EVENTS.map((event) => (
                    <th key={event} scope="col">
                      {eventName(event)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...new Set(shares.channels.map(({ channel }) => channel))].map((channel) => (
                  <tr key={channel}>
                    <th scope="row">{channelName(channel)}</th>
                    {EVENTS.map((event) => (
                      <td key={event}>
                        {number.format(
                          shares.channels.find(
                            (row) => row.channel === channel && row.event === event,
                          )?.count ?? 0,
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className={styles.h2}>{t('sharesPage.byPage')}</h3>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('sharesPage.page')}</th>
                  {EVENTS.map((event) => (
                    <th key={event} scope="col">
                      {eventName(event)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shares.pages.map((page) => (
                  <tr key={page.path}>
                    <th scope="row" className={styles.breakAnywhere}>
                      <code>{page.path}</code>
                    </th>
                    {EVENTS.map((event) => (
                      <td key={event}>{number.format(page[event])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className={styles.h2}>{t('sharesPage.byDay')}</h3>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('sharesPage.day')}</th>
                  {EVENTS.map((event) => (
                    <th key={event} scope="col">
                      {eventName(event)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...shares.days].reverse().map((day) => (
                  <tr key={day.day}>
                    <th scope="row">{dayName(day.day)}</th>
                    {EVENTS.map((event) => (
                      <td key={event}>{number.format(day[event])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
};

export default SharesPage;
