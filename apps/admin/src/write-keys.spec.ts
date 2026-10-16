import { messages } from '@aiontheballot/i18n/messages';
import { describe, expect, it } from 'vitest';

import { WRITE_ERRORS } from './write';

describe('WRITE_ERRORS', () => {
  // The API's refusal keys each have a message (apps/api's refusal-keys.spec.ts); this keeps the admin from dropping
  // one it doesn't list into "unexpected".
  it('lists every error the messages word, and only those', () => {
    expect([...WRITE_ERRORS].sort()).toEqual(Object.keys(messages.en.errors).sort());
  });
});
