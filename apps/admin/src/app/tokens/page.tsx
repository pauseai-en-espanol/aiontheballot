import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getTokens } from '@/data';
import { fill } from '@/fill';
import { getLocale } from '@/locale';
import { requireStage } from '@/session';
import { TokensPanel } from '@/tokens/TokensPanel';
import * as styles from '@/ui/styles';
import { template, writeErrors } from '@/ui/text';

export const generateMetadata = async (): Promise<Metadata> => ({
  title: getTranslator(await getLocale())('admin.tokens.title'),
});

/**
 * A member's tokens for tools (ADR-0008, PLAN R203): what a token lets a tool do and not do, a new one, and the list.
 * The member's own, whatever site they work on, so it hangs off the admin's home rather than a site.
 */
const TokensPage = async () => {
  await requireStage('signed-in');
  const list = await getTokens();
  if (!list) {
    notFound();
  }
  const locale = await getLocale();
  const t = getTranslator(locale);
  const when = (instant: string | null) =>
    instant === null
      ? t('admin.tokens.never')
      : new Date(instant).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const rows = list.tokens.map((token) => ({
    id: token.id,
    name: token.name,
    created: when(token.createdAt),
    expires: when(token.expiresAt),
    lastUsed: when(token.lastUsedAt),
    status: token.status,
  }));
  return (
    <main id="main" className={styles.narrow}>
      <p>
        <Link className={styles.link} href="/">
          {t('auth.home.title')}
        </Link>
      </p>
      <h1 className={styles.h1}>{t('admin.tokens.title')}</h1>
      <p className={styles.text}>{t('admin.tokens.intro')}</p>
      <p className={styles.text}>{t('admin.tokens.limits')}</p>
      <p className={styles.text}>{t('admin.tokens.care')}</p>
      <p className={styles.text}>
        {fill(template(t, 'admin.tokens.atMost'), { max: String(list.maxActive) })}
      </p>
      <TokensPanel
        rows={rows}
        maxDays={list.maxDays}
        text={{
          create: t('admin.tokens.create'),
          name: t('admin.tokens.name'),
          nameHint: t('admin.tokens.nameHint'),
          days: t('admin.tokens.days'),
          daysHint: template(t, 'admin.tokens.daysHint'),
          submit: t('admin.tokens.submit'),
          created: t('admin.tokens.created'),
          yours: t('admin.tokens.yours'),
          copy: t('admin.tokens.copy'),
          copied: t('admin.tokens.copied'),
          list: t('admin.tokens.list'),
          none: t('admin.tokens.none'),
          columns: {
            name: t('admin.tokens.columns.name'),
            created: t('admin.tokens.columns.created'),
            expires: t('admin.tokens.columns.expires'),
            lastUsed: t('admin.tokens.columns.lastUsed'),
            status: t('admin.tokens.columns.status'),
            actions: t('admin.tokens.columns.actions'),
          },
          status: {
            active: t('admin.tokens.status.active'),
            expired: t('admin.tokens.status.expired'),
            revoked: t('admin.tokens.status.revoked'),
          },
          revoke: {
            button: t('admin.tokens.revoke.button'),
            label: template(t, 'admin.tokens.revoke.label'),
            title: t('admin.tokens.revoke.title'),
            body: t('admin.tokens.revoke.body'),
            confirm: t('admin.tokens.revoke.confirm'),
            cancel: t('admin.tokens.revoke.cancel'),
            done: t('admin.tokens.revoke.done'),
          },
          required: t('admin.form.problems.required'),
          errors: writeErrors(t),
        }}
      />
    </main>
  );
};

export default TokensPage;
