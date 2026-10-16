import { RATING_SCALES } from '@aiontheballot/domain/methodology';
import { getTranslator, type Locale } from '@aiontheballot/i18n/messages';
import { css } from '@styled-system/css';

import { ratingLabel } from '../rating-label';
import { focusRing } from '../styles';
import { RatingBadge } from './rating';

/**
 * The legend every scorecard, party, criterion and cell page shows: each rating of the methodology's scale and the
 * pending state, with icon, words and colour, and the link to the methodology (BRIEF §3 invariant 2).
 */
export const RatingLegend = ({
  locale,
  kind,
  methodologyHref,
}: {
  locale: Locale;
  kind: keyof typeof RATING_SCALES;
  methodologyHref: string;
}) => {
  const t = getTranslator(locale);
  return (
    <section
      aria-labelledby="leyenda"
      className={css({
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '12px 24px',
        paddingBlock: '16px',
        borderBlock: '1px solid',
        borderColor: 'border.subtle',
        marginBlock: '24px',
        fontSize: '16px',
      })}
    >
      <h2 id="leyenda" className={css({ fontWeight: '700', fontSize: '16px' })}>
        {t('election.legend')}
      </h2>
      <ul
        className={css({ display: 'flex', flexWrap: 'wrap', gap: '8px 20px', listStyle: 'none' })}
      >
        {[...RATING_SCALES[kind], 'pending' as const].map((rating) => (
          <li key={rating}>
            <RatingBadge rating={rating} label={ratingLabel(locale, rating)} />
          </li>
        ))}
      </ul>
      <a
        href={methodologyHref}
        data-invariant="methodology-link"
        className={`${focusRing} ${css({ textDecoration: 'underline', textUnderlineOffset: '3px', fontWeight: '700' })}`}
      >
        {t('election.methodologyLink')}
      </a>
    </section>
  );
};
