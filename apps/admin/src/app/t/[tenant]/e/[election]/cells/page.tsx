import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getCellGrid, type GridCell } from '@/cells/data';
import { getTenant } from '@/data';
import { getLocale } from '@/locale';
import { inLanguage } from '@/localized';
import { Lang } from '@/ui/Lang';
import { RatingBadge } from '@/ui/RatingIcon';
import * as styles from '@/ui/styles';

interface CellsParams {
  params: Promise<{ tenant: string; election: string }>;
}

export const generateMetadata = async (): Promise<Metadata> => ({
  title: getTranslator(await getLocale())('admin.cells.title'),
});

/**
 * An election's cell grid (editorial workflow C1.1): parties down the side and criteria across the top, as in the
 * public table, each cell a link to its page with its published rating as the public sees it (icon, words and colour:
 * pending until a first publish, withdrawn after a withdrawal), then its working state and flags in words.
 */
const CellsPage = async ({ params }: CellsParams) => {
  const { tenant: slug, election } = await params;
  const [overview, grid] = await Promise.all([getTenant(slug), getCellGrid(slug, election)]);
  if (!overview || !grid) {
    notFound();
  }
  const locale = await getLocale();
  const t = getTranslator(locale);
  const defaultLocale = overview.tenant.defaultLocale;
  const text = (value: Record<string, string> | null, fallback: string) =>
    (value && inLanguage(value, locale, defaultLocale)) ?? { text: fallback, lang: locale };
  const parties = grid.parties.filter((p) => !p.retired);
  const criteria = grid.criteria.filter((c) => !c.retired);
  const byPair = new Map(grid.cells.map((c) => [`${c.partyId}/${c.criterionId}`, c]));
  const base = `/t/${overview.tenant.slug}/e/${grid.election.slug}/cells`;
  /** The public's view of the cell: its published rating, or withdrawn, or pending (§2.5). */
  const shown = (cell: GridCell | undefined) =>
    !cell?.published
      ? ({ rating: 'pending', label: t('cell.pending') } as const)
      : cell.published.rating === null
        ? ({ rating: 'withdrawn', label: t('cell.withdrawn') } as const)
        : { rating: cell.published.rating, label: t(`rating.${cell.published.rating}`) };
  const describe = (cell: GridCell | undefined): string[] => {
    if (!cell) {
      return [t('admin.cells.states.none')];
    }
    const parts = [t(`admin.cells.states.${cell.working}`)];
    if (cell.rejection) {
      parts.push(t('admin.cells.rejected'));
    }
    if (cell.recheck) {
      parts.push(t('admin.cells.recheck'));
    }
    return parts;
  };
  return (
    <>
      <h2 className={styles.h2}>{t('admin.cells.title')}</h2>
      <p className={styles.text}>{t('admin.cells.intro')}</p>
      {parties.length === 0 || criteria.length === 0 ? (
        <p className={styles.text}>{t('admin.cells.noStructure')}</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption>{t('admin.cells.caption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('admin.cells.party')}</th>
                {criteria.map((criterion) => (
                  <th key={criterion.id} scope="col">
                    <Lang
                      value={text(criterion.shortTitle ?? criterion.title, criterion.slug)}
                      page={locale}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {parties.map((party) => (
                <tr key={party.id}>
                  <th scope="row">
                    <Lang value={text(party.name, party.slug)} page={locale} />
                  </th>
                  {criteria.map((criterion) => {
                    const cell = byPair.get(`${party.id}/${criterion.id}`);
                    const rating = shown(cell);
                    const state = describe(cell).join(' · ');
                    return (
                      <td key={criterion.id}>
                        <Link
                          className={styles.link}
                          href={`${base}/${party.id}/${criterion.id}`}
                          // Its row and column say which cell; a list of links needs them in the name.
                          aria-label={t('admin.cells.gridCell', {
                            party: text(party.shortName, party.slug).text,
                            criterion: text(criterion.shortTitle ?? criterion.title, criterion.slug)
                              .text,
                            state: `${rating.label} · ${state}`,
                          })}
                        >
                          <span className={styles.gridCell}>
                            <RatingBadge rating={rating.rating} label={rating.label} />
                            {/* Apart, as its name says them (WCAG 2.5.3); the layout ignores the space. */}{' '}
                            <span>{state}</span>
                          </span>
                        </Link>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};

export default CellsPage;
