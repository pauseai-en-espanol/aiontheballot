'use client';

import dynamic from 'next/dynamic';

/**
 * The invitation page, rendered in the browser only: its token is in the URL's fragment, which the server never
 * receives, so there is nothing to render there.
 */
export const InvitationLoader = dynamic(
  async () => (await import('./InvitationForm')).InvitationForm,
  { ssr: false },
);
