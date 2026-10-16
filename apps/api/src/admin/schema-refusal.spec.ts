import { describe, expect, it } from 'vitest';

import { schemaRefusal } from './schema-refusal.js';

/** An error as Fastify throws it when a request's schema refuses it. */
const refused = (context: string, ...validation: object[]) =>
  Object.assign(new Error('body/name must NOT have more than 200 characters'), {
    statusCode: 400,
    code: 'FST_ERR_VALIDATION',
    validation,
    validationContext: context,
  });

describe("a schema's refusal (admin forms §1.2, PLAN R189)", () => {
  it("names the body's field it is about, at the top of the body, never the value or the schema's words", () => {
    expect(
      schemaRefusal(
        refused('body', { keyword: 'maxLength', instancePath: '/name/es', params: { limit: 200 } }),
      ),
    ).toEqual({ error: 'invalid', field: 'name' });
    expect(
      schemaRefusal(
        refused('body', {
          keyword: 'required',
          instancePath: '',
          params: { missingProperty: 'slug' },
        }),
      ),
    ).toEqual({ error: 'invalid', field: 'slug' });
    expect(
      schemaRefusal(
        refused('body', {
          keyword: 'required',
          instancePath: '/values',
          params: { missingProperty: 'name' },
        }),
      ),
    ).toEqual({ error: 'invalid', field: 'values' });
    expect(
      schemaRefusal(refused('body', { keyword: 'type', instancePath: '/a~1b', params: {} })),
    ).toEqual({ error: 'invalid', field: 'a/b' });
  });

  it('names no field for a refusal of the address, or one about the body as a whole', () => {
    expect(
      schemaRefusal(refused('params', { keyword: 'format', instancePath: '/id', params: {} })),
    ).toEqual({ error: 'invalid' });
    expect(
      schemaRefusal(
        refused('body', {
          keyword: 'additionalProperties',
          instancePath: '',
          params: { additionalProperty: 'x' },
        }),
      ),
    ).toEqual({ error: 'invalid' });
  });

  it('leaves any other error to Fastify', () => {
    expect(schemaRefusal(new Error('boom'))).toBeUndefined();
    expect(
      schemaRefusal(Object.assign(new Error('too large'), { statusCode: 413 })),
    ).toBeUndefined();
  });
});
