import { getTranslator, type Locale } from '@aiontheballot/i18n/messages';
import { css, cx } from '@styled-system/css';

import { SIGNUP_ANCHOR, type SignupOutcome } from '../signup-outcomes';

/** Splits a message around a placeholder, so a link can sit inside it in any language's word order. */
const around = (text: string, marker: string): [string, string] => {
  const [before = '', after = ''] = text.split(marker);
  return [before, after];
};

interface SignupFormProps {
  locale: Locale;
  /** The form's target: the site's `/avisos` (`/updates`) in this locale. */
  action: string;
  privacyHref: string;
  outcome: SignupOutcome | undefined;
}

const field = css({
  width: '100%',
  minHeight: '52px',
  paddingInline: '14px',
  fontSize: '18px',
  border: '3px solid',
  borderColor: 'border.default',
  bg: 'bg.canvas',
  color: 'fg.default',
  _focusVisible: { outline: '3px solid', outlineColor: 'border.default', outlineOffset: '3px' },
});

/**
 * "Avísame cuando esté listo" (PLAN R119; public-site spec §6): an email field, an optional box left unticked, a
 * consent line linking to the privacy policy, and what happens to the address, said before anything is sent. A plain
 * form, so it works without scripts; the answer comes back in the home's query, announced in a status region.
 */
export const SignupForm = ({ locale, action, privacyHref, outcome }: SignupFormProps) => {
  const t = getTranslator(locale);
  const marker = '\u0000';
  const [consentBefore, consentAfter] = around(t('signup.consent', { privacy: marker }), marker);
  return (
    <section
      id={SIGNUP_ANCHOR}
      aria-labelledby="avisos-titulo"
      className={css({
        bg: 'bg.canvas',
        color: 'fg.default',
        paddingBlock: 'clamp(48px, 7vh, 80px)',
      })}
    >
      <div
        className={css({
          width: '100%',
          maxWidth: '1200px',
          marginInline: 'auto',
          paddingInline: 'clamp(16px, 4vw, 56px)',
          display: 'grid',
          gridTemplateColumns: { base: '1fr', md: '1fr 1fr' },
          gap: '32px 64px',
          alignItems: 'start',
        })}
      >
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '16px' })}>
          <h2
            id="avisos-titulo"
            className={css({
              fontFamily: 'display',
              fontWeight: '700',
              textTransform: 'uppercase',
              fontSize: 'clamp(32px, 3.5vw, 46px)',
              lineHeight: '1',
            })}
          >
            {t('signup.title')}
          </h2>
          <p
            id="avisos-como"
            className={css({ fontSize: '17px', lineHeight: '1.55', maxWidth: '52ch' })}
          >
            {t('signup.how')}
          </p>
        </div>
        <form
          method="post"
          action={action}
          className={css({ display: 'flex', flexDirection: 'column', gap: '18px' })}
        >
          <div className={css({ display: 'flex', flexDirection: 'column', gap: '8px' })}>
            <label htmlFor="avisos-correo" className={css({ fontWeight: '700', fontSize: '18px' })}>
              {t('signup.email')}
            </label>
            <input
              id="avisos-correo"
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              spellCheck={false}
              aria-describedby="avisos-como avisos-consentimiento"
              className={field}
            />
          </div>
          <div className={css({ display: 'flex', alignItems: 'flex-start', gap: '12px' })}>
            <input
              id="avisos-futuras"
              name="future"
              type="checkbox"
              value="1"
              className={css({
                width: '24px',
                height: '24px',
                flexShrink: '0',
                marginTop: '2px',
                accentColor: 'fg.default',
              })}
            />
            <label
              htmlFor="avisos-futuras"
              className={css({ fontSize: '17px', lineHeight: '1.45' })}
            >
              {t('signup.future')}
            </label>
          </div>
          <p id="avisos-consentimiento" className={css({ fontSize: '16px', lineHeight: '1.5' })}>
            {consentBefore}
            <a
              href={privacyHref}
              className={css({
                textDecoration: 'underline',
                textUnderlineOffset: '3px',
                _focusVisible: {
                  outline: '3px solid',
                  outlineColor: 'currentColor',
                  outlineOffset: '3px',
                },
              })}
            >
              {t('signup.privacyLink')}
            </a>
            {consentAfter}
          </p>
          <button
            type="submit"
            className={cx(
              css({
                alignSelf: 'flex-start',
                minHeight: '52px',
                paddingInline: '28px',
                fontFamily: 'display',
                fontWeight: '700',
                textTransform: 'uppercase',
                fontSize: '22px',
                letterSpacing: '0.02em',
                bg: 'bg.inverse',
                color: 'fg.inverse',
                border: '3px solid',
                borderColor: 'border.default',
                cursor: 'pointer',
                _hover: { color: 'fg.accentOnInverse' },
                _focusVisible: {
                  outline: '3px solid',
                  outlineColor: 'border.default',
                  outlineOffset: '3px',
                },
              }),
            )}
          >
            {t('signup.submit')}
          </button>
          <p
            role="status"
            className={css({ fontSize: '18px', fontWeight: '700', minHeight: '1.5em' })}
          >
            {outcome ? t(`signup.outcome.${outcome}`) : ''}
          </p>
        </form>
      </div>
    </section>
  );
};
