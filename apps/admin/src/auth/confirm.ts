/**
 * "Confirm it's you" (PLAN D23): the riskiest actions want a second factor of the last 12 hours, and the page that asks
 * for it sends the person back to where they were. Plain functions, for pages and the browser alike.
 */

/** Where to go back to: a path of the admin, never another site (`//elsewhere`, `/\elsewhere`) nor a full address. */
export const safeNext = (next: unknown): string =>
  typeof next === 'string' && /^\/(?![/\\])/u.test(next) ? next : '/';

/** The page that asks to confirm, coming back to `next`. */
export const confirmPath = (next: string): string =>
  `/confirm?${new URLSearchParams({ next: safeNext(next) }).toString()}`;

/** Where the browser is now, to come back to. */
export const here = (): string => `${window.location.pathname}${window.location.search}`;
