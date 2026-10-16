import { getTranslator, type Locale } from '@aiontheballot/i18n/messages';
import Link from 'next/link';

import type { AuditPage, AuditQuery } from '@/audit/data';

import * as styles from '@/ui/styles';

/** A value as the log holds it, short: what changed is the point, not every byte of it. */
const shown = (value: unknown): string => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The audit log (editorial workflow H3): who did what to which row, and when, newest first, with what changed, by
 * column (personal data is never in it). Filters by actor, table, row and day, as a plain form; older entries a page
 * at a time.
 */
export const AuditView = ({
  page,
  query,
  path,
  locale,
  withMembers,
}: {
  page: AuditPage;
  query: AuditQuery;
  /** This page's own address, for the filters and the next page. */
  path: string;
  locale: Locale;
  /** Whether actors are a site's members, to choose among. */
  withMembers: boolean;
}) => {
  const t = getTranslator(locale);
  const actorName = (id: string | null) =>
    id === null
      ? t('admin.audit.system')
      : (page.names[id] ?? t('admin.audit.someone', { id: id.slice(0, 8) }));
  const older = page.next
    ? `${path}?${new URLSearchParams({ ...(query as Record<string, string>), before: page.next }).toString()}`
    : undefined;
  return (
    <>
      <form
        method="get"
        action={path}
        className={styles.form}
        aria-label={t('admin.audit.filters')}
      >
        {withMembers ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="audit-actor">
              {t('admin.audit.actor')}
            </label>
            <select
              id="audit-actor"
              name="actor"
              className={styles.select}
              defaultValue={query.actor ?? ''}
            >
              <option value="">{t('admin.audit.anyone')}</option>
              {Object.entries(page.members).map(([id, name]) => (
                <option key={id} value={id}>
                  {name ?? t('admin.audit.someone', { id: id.slice(0, 8) })}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="audit-table">
            {t('admin.audit.table')}
          </label>
          <select
            id="audit-table"
            name="table"
            className={styles.select}
            defaultValue={query.table ?? ''}
          >
            <option value="">{t('admin.audit.anyTable')}</option>
            {page.tables.map((table) => (
              <option key={table} value={table}>
                {table}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="audit-row">
            {t('admin.audit.row')}
          </label>
          <input
            id="audit-row"
            name="row"
            className={styles.input}
            defaultValue={query.row ?? ''}
            maxLength={200}
          />
        </div>
        <div className={styles.buttonRow}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="audit-from">
              {t('admin.audit.from')}
            </label>
            <input
              id="audit-from"
              name="from"
              type="date"
              className={styles.input}
              defaultValue={query.from ?? ''}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="audit-to">
              {t('admin.audit.to')}
            </label>
            <input
              id="audit-to"
              name="to"
              type="date"
              className={styles.input}
              defaultValue={query.to ?? ''}
            />
          </div>
        </div>
        <div className={styles.buttonRow}>
          <button className={styles.button} type="submit">
            {t('admin.audit.apply')}
          </button>
          <Link className={styles.link} href={path}>
            {t('admin.audit.clear')}
          </Link>
        </div>
      </form>
      {page.entries.length === 0 ? (
        <p className={styles.text}>{t('admin.audit.empty')}</p>
      ) : (
        // Row ids and values are long unbroken strings: they wrap anywhere, so a phone never scrolls sideways.
        <ol className={`${styles.list} ${styles.breakAnywhere}`}>
          {page.entries.map((entry) => {
            const diff = isObject(entry.diff) ? entry.diff : {};
            const before = isObject(diff.old) ? diff.old : {};
            const after = isObject(diff.new) ? diff.new : {};
            const columns = [...new Set([...Object.keys(before), ...Object.keys(after)])];
            return (
              <li key={entry.id}>
                <p>
                  <strong>
                    {t(
                      `admin.audit.actions.${entry.action === 'insert' || entry.action === 'delete' ? entry.action : 'update'}`,
                    )}
                  </strong>{' '}
                  {entry.table} <code>{entry.rowId}</code> · {actorName(entry.actorId)} ·{' '}
                  {/* In UTC, as the filters' days are. */}
                  {new Date(entry.at).toLocaleString(locale, {
                    dateStyle: 'medium',
                    timeStyle: 'medium',
                    timeZone: 'UTC',
                  })}{' '}
                  UTC
                </p>
                {columns.length > 0 ? (
                  <ul className={styles.hint}>
                    {columns.map((column) => (
                      <li key={column}>
                        {entry.action === 'update'
                          ? t('admin.audit.changed', {
                              column,
                              before: shown(before[column] ?? null),
                              after: shown(after[column] ?? null),
                            })
                          : `${column}: ${shown(after[column] ?? before[column] ?? null)}`}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {older ? (
        <p>
          <Link className={styles.link} href={older}>
            {t('admin.audit.older')}
          </Link>
        </p>
      ) : null}
    </>
  );
};
