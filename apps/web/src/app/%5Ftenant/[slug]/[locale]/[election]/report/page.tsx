import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import { css, cx } from '@styled-system/css';

import { ElectionFrame } from '@/components/election-frame';
import { type ElectionPageParams, loadElectionPage } from '@/election-page';
import { localText } from '@/local-text';
import { renderMarkdown } from '@/markdown';
import { pageMetadata } from '@/page-metadata';
import { isReportOutcome } from '@/report-route';
import { focusRing, prose } from '@/styles';

interface ReportProps extends ElectionPageParams {
  searchParams: Promise<{
    partido?: string | string[];
    criterio?: string | string[];
    enviado?: string | string[];
  }>;
}

/**
 * When the form was served, for the route's time trap (report-route.ts). The page renders once per request on the
 * server, never again in a browser, so the time is the request's.
 */
const servedAt = (): string => String(Date.now());

const one = (value: string | string[] | undefined): string | undefined =>
  typeof value === 'string' ? value : undefined;

export const generateMetadata = async (props: ReportProps): Promise<Metadata> => {
  const page = await loadElectionPage(props);
  const t = getTranslator(page.locale);
  return pageMetadata({
    ...page,
    target: { page: 'report', election: page.election.election.slug },
    title: t('reportPage.title'),
    description: t('reportPage.lead'),
    // A form, not content: never listed by a search engine.
    noindex: true,
  });
};

const field = css({
  width: '100%',
  minHeight: '48px',
  paddingInline: '12px',
  fontSize: '18px',
  border: '2px solid',
  borderColor: 'border.default',
  bg: 'bg.canvas',
  color: 'fg.default',
  _focusVisible: { outline: '3px solid', outlineColor: 'border.default', outlineOffset: '3px' },
});
const label = css({ fontWeight: '700', fontSize: '18px' });
const stack = css({ display: 'flex', flexDirection: 'column', gap: '8px' });
const link = cx(focusRing, css({ textDecoration: 'underline', textUnderlineOffset: '3px' }));

/**
 * The right-of-reply form (BRIEF §4; PLAN R149): an error in a rating, or a party's reply, about the election or one
 * of its cells, with the site's right-of-reply policy above it when published. A plain form posting to the site's own
 * route, so no script and no cookie; the answer comes back in the query, in a status region. Offered only once the
 * site has published its privacy policy, since a report may hold personal data.
 */
const Report = async (props: ReportProps) => {
  const page = await loadElectionPage(props);
  const { locale, href } = page;
  const t = getTranslator(locale);
  const { home } = page.page;
  const defaultLocale = home.tenant.defaultLocale;
  const query = await props.searchParams;
  const outcome = one(query.enviado);
  const election = page.election.election.slug;
  const party = page.election.parties.find((p) => p.slug === one(query.partido));
  const criterion = page.election.criteria.find((c) => c.slug === one(query.criterio));
  const cell = party && criterion ? { party, criterion } : undefined;
  const policy = home.documents.right_of_reply_policy;
  const policyLocale = policy?.body[locale] ? locale : defaultLocale;
  const privacy = home.documents.privacy_policy;
  const marker = '\u0000';
  const [consentBefore = '', consentAfter = ''] = t('reportPage.consent', {
    privacy: marker,
  }).split(marker);
  return (
    <ElectionFrame page={page} target={{ page: 'report', election }} title={t('reportPage.title')}>
      <p className={css({ fontSize: '19px', lineHeight: '1.55', maxWidth: '65ch' })}>
        {t('reportPage.lead')}
      </p>
      {policy && (
        <section aria-labelledby="replica" className={css({ marginTop: '32px' })}>
          <h2
            id="replica"
            className={css({ fontSize: '22px', fontWeight: '700', marginBottom: '8px' })}
          >
            {t('reportPage.policy')}
          </h2>
          <div
            lang={policyLocale}
            className={prose}
            // Rendered from Markdown with raw HTML off and only http(s) and mailto links (markdown.ts).
            // oxlint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: renderMarkdown(policy.body[policyLocale] ?? '') }}
          />
        </section>
      )}
      {privacy && home.reports === true ? (
        <form
          id="formulario"
          method="post"
          action={href({ page: 'reportSend', election })}
          className={css({
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            marginTop: '32px',
            maxWidth: '40rem',
          })}
        >
          {cell ? (
            <p className={css({ fontSize: '18px' })}>
              {t('reportPage.about', {
                party: localText(cell.party.name, locale, defaultLocale).text,
                criterion: localText(cell.criterion.title, locale, defaultLocale).text,
              })}{' '}
              <a href={href({ page: 'report', election })} className={link}>
                {t('reportPage.aboutElection')}
              </a>
              <input type="hidden" name="partido" value={cell.party.slug} />
              <input type="hidden" name="criterio" value={cell.criterion.slug} />
            </p>
          ) : null}
          <fieldset className={cx(stack, css({ border: 'none', padding: '0' }))}>
            <legend className={label}>{t('reportPage.kind')}</legend>
            {(['error_report', 'party_response'] as const).map((kind, index) => (
              <div
                key={kind}
                className={css({ display: 'flex', alignItems: 'center', gap: '10px' })}
              >
                <input
                  id={`tipo-${kind}`}
                  type="radio"
                  name="kind"
                  value={kind}
                  required
                  defaultChecked={index === 0}
                  className={css({ width: '22px', height: '22px', accentColor: 'fg.default' })}
                />
                <label htmlFor={`tipo-${kind}`} className={css({ fontSize: '18px' })}>
                  {t(`reportPage.kinds.${kind}`)}
                </label>
              </div>
            ))}
          </fieldset>
          <div className={stack}>
            <label htmlFor="mensaje" className={label}>
              {t('reportPage.message')}
            </label>
            <p id="mensaje-pista" className={css({ fontSize: '16px', color: 'fg.muted' })}>
              {t('reportPage.messageHint')}
            </p>
            <textarea
              id="mensaje"
              name="message"
              required
              maxLength={4800}
              rows={8}
              aria-describedby="mensaje-pista"
              className={cx(field, css({ paddingBlock: '10px', minHeight: '200px' }))}
            />
          </div>
          {(
            [
              ['nombre', 'name', 'reportPage.name', 'name', 'text'],
              ['correo', 'email', 'reportPage.email', 'email', 'email'],
              ['organizacion', 'organization', 'reportPage.organization', 'organization', 'text'],
            ] as const
          ).map(([id, name, text, autoComplete, type]) => (
            <div key={id} className={stack}>
              <label htmlFor={id} className={label}>
                {t(text)}
              </label>
              <input
                id={id}
                name={name}
                type={type}
                maxLength={200}
                autoComplete={autoComplete}
                className={field}
              />
            </div>
          ))}
          <div className={css({ display: 'flex', alignItems: 'center', gap: '10px' })}>
            <input
              id="representante"
              type="checkbox"
              name="representative"
              value="1"
              className={css({ width: '22px', height: '22px', accentColor: 'fg.default' })}
            />
            <label htmlFor="representante" className={css({ fontSize: '18px' })}>
              {t('reportPage.representative')}
            </label>
          </div>
          {/* Never seen nor read out: a bot fills it, a person doesn't (report-route.ts). */}
          <div
            aria-hidden="true"
            className={css({
              position: 'absolute',
              left: '-10000px',
              width: '1px',
              height: '1px',
              overflow: 'hidden',
            })}
          >
            <label htmlFor="sitio-web">{t('reportPage.trap')}</label>
            <input id="sitio-web" name="website" type="text" tabIndex={-1} autoComplete="off" />
          </div>
          <input type="hidden" name="t" value={servedAt()} />
          <p className={css({ fontSize: '16px', lineHeight: '1.5' })}>
            {consentBefore}
            <a href={href({ page: 'privacy' })} className={link}>
              {t('reportPage.privacyLink')}
            </a>
            {consentAfter}
          </p>
          <button
            type="submit"
            className={cx(
              focusRing,
              css({
                alignSelf: 'flex-start',
                minHeight: '52px',
                paddingInline: '28px',
                fontFamily: 'display',
                fontWeight: '700',
                textTransform: 'uppercase',
                fontSize: '22px',
                bg: 'bg.inverse',
                color: 'fg.inverse',
                border: '3px solid',
                borderColor: 'border.default',
                cursor: 'pointer',
              }),
            )}
          >
            {t('reportPage.submit')}
          </button>
          <p
            role="status"
            className={css({ fontSize: '18px', fontWeight: '700', minHeight: '1.5em' })}
          >
            {isReportOutcome(outcome) ? t(`reportPage.outcome.${outcome}`) : ''}
          </p>
        </form>
      ) : (
        <div className={css({ marginTop: '32px', fontSize: '18px' })}>
          <p>{t('reportPage.closed')}</p>
          {home.operator.contactEmail && (
            <p>{t('reportPage.closedContact', { email: home.operator.contactEmail })}</p>
          )}
        </div>
      )}
    </ElectionFrame>
  );
};

export default Report;
