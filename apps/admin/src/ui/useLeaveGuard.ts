import { useEffect } from 'react';

import { leavesPage } from './leave-guard';

/**
 * While `active`, asks before the page is left (admin forms §2, PLAN R190): the browser's own question when the tab is
 * closed or reloaded, and `question`, in the page's language, when one of its links would replace it. The browser's
 * back button can't be asked about.
 */
export const useLeaveGuard = (active: boolean, question: string): void => {
  useEffect(() => {
    if (!active) {
      return undefined;
    }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    // In the capture phase, before Next's links act on the click.
    const click = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a') : null;
      if (
        anchor &&
        leavesPage(
          {
            href: anchor.getAttribute('href'),
            target: anchor.target,
            download: anchor.hasAttribute('download'),
            button: event.button,
            modified: event.metaKey || event.ctrlKey || event.shiftKey || event.altKey,
          },
          window.location.href,
        ) &&
        !window.confirm(question)
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', click, true);
    };
  }, [active, question]);
};
