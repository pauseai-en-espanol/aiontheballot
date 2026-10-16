/** What a click on a link is, as far as leaving the page goes. */
export interface LinkClick {
  /** The link's address as written, or none for an anchor without one. */
  href: string | null;
  target: string;
  download: boolean;
  /** The mouse button: 0 for a plain click (or a key). */
  button: number;
  /** Whether a modifier key was held (a new tab or window). */
  modified: boolean;
}

/**
 * Whether a click on a link would replace this page in its tab (admin forms §2, PLAN R190), and so drop unsaved edits:
 * not a link to a place on this same page, nor one that opens a new tab or window, or downloads.
 */
export const leavesPage = (click: LinkClick, here: string): boolean => {
  if (
    click.href === null ||
    click.button !== 0 ||
    click.modified ||
    click.download ||
    (click.target !== '' && click.target !== '_self')
  ) {
    return false;
  }
  const to = new URL(click.href, here);
  const from = new URL(here);
  return !(
    to.hash !== '' &&
    to.origin === from.origin &&
    to.pathname === from.pathname &&
    to.search === from.search
  );
};
