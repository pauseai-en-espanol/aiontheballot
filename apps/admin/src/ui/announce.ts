/** The event the page's announcer listens for (Announcer.tsx). */
export const ANNOUNCE_EVENT = 'admin:announce';

/**
 * Says what just happened in the page's own status line, which stays put while the page reloads its data, and moves
 * focus there: for a change that removes the very control that made it (a deleted item's button), whose own status
 * line would go with it.
 */
export const announce = (message: string): void => {
  window.dispatchEvent(new CustomEvent<string>(ANNOUNCE_EVENT, { detail: message }));
};
