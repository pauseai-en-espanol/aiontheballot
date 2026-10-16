import type { PublicParty } from '@aiontheballot/domain/public-election';

import { getTranslator, type Locale } from '@aiontheballot/i18n/messages';
import { css } from '@styled-system/css';

/**
 * A party's programme status (public-site spec §5): "Programa aún no publicado (comprobado el …)" while pending and
 * checked; nothing once published (its sources show on the cells), nor before anyone has checked.
 */
export const ProgrammeStatus = ({
  party,
  locale,
  compact = false,
}: {
  party: PublicParty;
  locale: Locale;
  compact?: boolean;
}) => {
  if (party.programmeStatus !== 'pending' || !party.programmeCheckedAt) {
    return null;
  }
  const t = getTranslator(locale);
  return (
    <p
      className={css({
        fontSize: compact ? '14px' : '16px',
        color: 'fg.muted',
        fontWeight: '400',
        marginTop: '4px',
      })}
    >
      {t('party.programmePending', { checkedAt: new Date(party.programmeCheckedAt) })}
    </p>
  );
};
