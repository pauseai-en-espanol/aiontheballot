import type { PublicRevision } from './public-election.js';

/** A published revision, and whether it was published while its election was in preview (PLAN R181). */
export interface StagedRevision {
  revision: PublicRevision;
  inPreview: boolean;
}

/**
 * A cell's history as its public sees it (PLAN R181), newest first: what was published while its election was in
 * preview was never public, so only the last such version is shown, as the first, with no note, dated no earlier than
 * the election went live (`since`); the later ones are numbered on from it. A cell withdrawn in preview shows nothing
 * until it is published again, and that version is then its first. A history with nothing published in preview is
 * returned as it is. The preview shows the same, as its public will first see it.
 */
export const publicHistory = (
  revisions: readonly StagedRevision[],
  { since }: { since?: string | null | undefined } = {},
): PublicRevision[] => {
  const published = revisions.filter(({ inPreview }) => !inPreview).map(({ revision }) => revision);
  const [latest] = revisions.filter(({ inPreview }) => inPreview).map(({ revision }) => revision);
  if (!latest) {
    return published;
  }
  const carried = latest.changeKind === 'withdrawal' ? undefined : latest;
  // The public's first version: the one carried over from preview, or the first published after a withdrawal there.
  const first = carried ?? published.at(-1);
  if (!first) {
    return [];
  }
  const later = carried ? published : published.slice(0, -1);
  const shift = first.revisionNo - 1;
  const publishedAt =
    carried && since && Date.parse(since) > Date.parse(first.publishedAt)
      ? since
      : first.publishedAt;
  return [
    ...later.map((revision) => ({ ...revision, revisionNo: revision.revisionNo - shift })),
    { ...first, revisionNo: 1, changeKind: 'initial', publicNote: null, publishedAt },
  ];
};
