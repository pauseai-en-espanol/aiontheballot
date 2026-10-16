/**
 * The slug a name makes (admin forms §1.5): its letters and digits without accents, lowercase, joined by single
 * hyphens, at most 63 characters, as the database's slugs are. What the slug field fills in until someone edits it.
 */
export const slugFrom = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 63)
    .replace(/-+$/u, '');
