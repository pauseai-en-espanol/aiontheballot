/** One of the schema's refusals, as Fastify passes them on (Ajv's errors). */
interface SchemaError {
  keyword?: unknown;
  instancePath?: unknown;
  params?: { missingProperty?: unknown };
}

/** A JSON pointer's segment, unescaped. */
const unescape = (segment: string) => segment.replaceAll('~1', '/').replaceAll('~0', '~');

/**
 * The answer to a request its route's schema refused (Fastify's validation, before the handler runs): `invalid`, and
 * the field of the body at fault, by the body's top-level name for it, so the admin marks that field (admin forms
 * §1.2, PLAN R189). Never the value nor the schema's own words. None for an error that isn't a schema's refusal.
 */
export const schemaRefusal = (error: unknown): { error: 'invalid'; field?: string } | undefined => {
  const { validation, validationContext } = (error ?? {}) as {
    validation?: unknown;
    validationContext?: unknown;
  };
  if (!Array.isArray(validation)) {
    return undefined;
  }
  const [first] = validation as SchemaError[];
  if (validationContext !== 'body' || !first) {
    return { error: 'invalid' };
  }
  const path = typeof first.instancePath === 'string' ? first.instancePath : '';
  const [, top] = path.split('/');
  const missing = first.params?.missingProperty;
  const field =
    top !== undefined && top !== ''
      ? unescape(top)
      : first.keyword === 'required' && typeof missing === 'string'
        ? missing
        : undefined;
  return { error: 'invalid', ...(field === undefined ? {} : { field }) };
};
