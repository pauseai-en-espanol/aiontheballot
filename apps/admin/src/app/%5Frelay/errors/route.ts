import { readDsn } from '@aiontheballot/observability/dsn';
import { relayErrors } from '@aiontheballot/observability/relay';

// The browser error relay at /_relay/errors (ADR-0003 §7). Next treats folders starting with `_` as private, hence
// the encoded `%5Frelay`. Only POST is exported, so any other method gets 405.
export const dynamic = 'force-dynamic';

export const POST = (request: Request): Promise<Response> =>
  relayErrors(request, { dsn: readDsn(process.env) });
