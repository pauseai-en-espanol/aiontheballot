import type { PublicRevision } from './public-election.js';

/**
 * A published revision, whether it was published while its election was in preview (PLAN R181), and whether it was
 * published off the record (PLAN R243).
 */
export interface StagedRevision {
  revision: PublicRevision;
  inPreview: boolean;
  unlogged?: boolean;
}

/**
 * The revisions the public is told of, newest first (PLAN R243): one published off the record takes the place of the
 * one before it, whose number, change kind and note it keeps, and the later ones are numbered on, so the public reads
 * what it says, dated when it was published, and nothing else says the cell changed. One after a withdrawal, which the
 * database refuses, would stand as its own.
 */
const onTheRecord = (revisions: readonly StagedRevision[]): StagedRevision[] => {
  if (!revisions.some(({ unlogged }) => unlogged)) {
    return [...revisions];
  }
  const told: StagedRevision[] = [];
  for (const { revision, inPreview, unlogged } of [...revisions].reverse()) {
    const before = told.at(-1);
    if (unlogged && before && before.revision.changeKind !== 'withdrawal') {
      told[told.length - 1] = {
        inPreview: before.inPreview,
        revision: {
          ...revision,
          revisionNo: before.revision.revisionNo,
          changeKind: before.revision.changeKind,
          publicNote: before.revision.publicNote,
        },
      };
    } else {
      told.push({ inPreview, revision: { ...revision, revisionNo: told.length + 1 } });
    }
  }
  return told.reverse();
};

/**
 * A cell's history as its public sees it (PLAN R181), newest first: what was published while its election was in
 * preview was never public, so only the last such version is shown, as the first, with no note, dated no earlier than
 * the election went live (`since`); the later ones are numbered on from it. A cell withdrawn in preview shows nothing
 * until it is published again, and that version is then its first. A history with nothing published in preview is
 * returned as it is. The preview shows the same, as its public will first see it. What was published off the record
 * is first folded into the revision before it (`onTheRecord`, PLAN R243).
 */
export const publicHistory = (
  all: readonly StagedRevision[],
  { since }: { since?: string | null | undefined } = {},
): PublicRevision[] => {
  const revisions = onTheRecord(all);
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
