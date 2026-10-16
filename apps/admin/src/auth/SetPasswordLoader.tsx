'use client';

import dynamic from 'next/dynamic';

/**
 * The set-password form, rendered in the browser only: its token is in the URL's fragment, which the server never
 * receives, so there is nothing to render there.
 */
export const SetPasswordLoader = dynamic(
  async () => (await import('./SetPasswordForm')).SetPasswordForm,
  { ssr: false },
);
