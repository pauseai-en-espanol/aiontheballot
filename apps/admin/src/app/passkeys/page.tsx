import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { authErrors } from '@/auth/text';
import { getPasskeys } from '@/data';
import { fill } from '@/fill';
import { getLocale } from '@/locale';
import { PasskeysPanel } from '@/passkeys/PasskeysPanel';
import { forwardedRequest, requireStage } from '@/session';
import * as styles from '@/ui/styles';
import { template, writeErrors } from '@/ui/text';

export const generateMetadata = async (): Promise<Metadata> => ({
  title: getTranslator(await getLocale())('admin.passkeys.title'),
});

/**
 * A member's passkeys (PLAN D22): what one is and that it is optional, a new one, and the list. The member's own,
 * whatever site they work on, so it hangs off the admin's home, beside their tokens.
 */
const PasskeysPage = async () => {
  await requireStage('signed-in');
  const passkeys = await getPasskeys();
  if (!passkeys) {
    notFound();
  }
  const locale = await getLocale();
  const t = getTranslator(locale);
  const rows = passkeys.map((passkey) => ({
    id: passkey.id,
    name: passkey.name ?? passkey.provider ?? t('admin.passkeys.unnamed'),
    keptIn: [
      passkey.provider ?? t('admin.passkeys.thisDevice'),
      ...(passkey.synced ? [t('admin.passkeys.synced')] : []),
    ].join(' · '),
    added:
      passkey.createdAt === null
        ? '—'
        : new Date(passkey.createdAt).toLocaleDateString(locale, { dateStyle: 'medium' }),
  }));
  return (
    <main id="main" className={styles.narrow}>
      <p>
        <Link className={styles.link} href="/">
          {t('auth.home.title')}
        </Link>
      </p>
      <h1 className={styles.h1}>{t('admin.passkeys.title')}</h1>
      <p className={styles.text}>{t('admin.passkeys.intro')}</p>
      <p className={styles.text}>{t('admin.passkeys.optional')}</p>
      <p className={styles.text}>
        {fill(template(t, 'admin.passkeys.host'), { host: (await forwardedRequest()).host })}
      </p>
      <PasskeysPanel
        rows={rows}
        text={{
          add: t('admin.passkeys.add'),
          name: t('admin.passkeys.name'),
          optional: t('admin.form.optional'),
          nameHint: t('admin.passkeys.nameHint'),
          submit: t('admin.passkeys.submit'),
          added: t('admin.passkeys.added'),
          list: t('admin.passkeys.list'),
          none: t('admin.passkeys.none'),
          columns: {
            name: t('admin.passkeys.columns.name'),
            keptIn: t('admin.passkeys.columns.keptIn'),
            added: t('admin.passkeys.columns.added'),
            actions: t('admin.passkeys.columns.actions'),
          },
          remove: {
            button: t('admin.passkeys.remove.button'),
            label: template(t, 'admin.passkeys.remove.label'),
            title: t('admin.passkeys.remove.title'),
            body: t('admin.passkeys.remove.body'),
            confirm: t('admin.passkeys.remove.confirm'),
            cancel: t('admin.passkeys.remove.cancel'),
            done: t('admin.passkeys.remove.done'),
          },
          restart: t('auth.challenge.restart'),
          authErrors: authErrors(t),
          errors: writeErrors(t),
        }}
      />
    </main>
  );
};

export default PasskeysPage;
