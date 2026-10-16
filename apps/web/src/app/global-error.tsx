'use client';

import { messages } from '@aiontheballot/i18n/catalog';
import { css } from '@styled-system/css';
import { useEffect } from 'react';

import './globals.css';

interface GlobalErrorProps {
  error: Error & { digest?: string };
}

// Shown when the root layout itself fails. React has already caught the error, so it is passed to the browser's
// reportError(), which raises it as an uncaught error for the error-tracking listeners. The plain message lookup
// keeps the message formatter out of the client bundle.
const GlobalError = ({ error }: GlobalErrorProps) => {
  useEffect(() => {
    reportError(error);
  }, [error]);

  return (
    <html lang="es">
      <body>
        <main
          className={css({
            maxWidth: '65ch',
            marginInline: 'auto',
            paddingInline: '4',
            paddingBlock: '16',
          })}
        >
          <h1 className={css({ fontSize: '2xl', fontWeight: 'semibold' })}>
            {messages.es.errors.unexpected}
          </h1>
        </main>
      </body>
    </html>
  );
};

export default GlobalError;
