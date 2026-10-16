/**
 * A message's `{name}` placeholders filled in, for client components, which ship no message formatter. Only for
 * messages with plain placeholders: no plurals, dates or numbers.
 */
export const fill = (template: string, values: Readonly<Record<string, string>>): string =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
