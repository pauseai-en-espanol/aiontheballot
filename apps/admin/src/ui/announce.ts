/** The event the page's announcer listens for (Announcer.tsx). */
export const ANNOUNCE_EVENT = 'admin:announce';

/** What to say, and whether to say it on the page a navigation the caller is starting leads to. */
export interface Announcement {
  message: string;
  afterNavigation: boolean;
}

/**
 * Says what just happened in the page's own status line, which stays put while the page reloads its data, and moves
 * focus there: for a change that removes the very control that made it (a deleted item's button), whose own status
 * line would go with it. With `afterNavigation`, it waits for the page the caller is about to open (a new item's own
 * page), since a new page starts the line empty.
 */
export const announce = (message: string, { afterNavigation = false } = {}): void => {
  window.dispatchEvent(
    new CustomEvent<Announcement>(ANNOUNCE_EVENT, { detail: { message, afterNavigation } }),
  );
};
