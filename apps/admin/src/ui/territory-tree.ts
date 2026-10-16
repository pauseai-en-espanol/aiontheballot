/** A subdivision of a site's country (ISO 3166-2), as the territory picker lists it (PLAN R201). */
export interface Territory {
  code: string;
  /** As ISO gives it, in the country's own language or languages: a proper name. */
  name: string;
  /** The subdivision it is part of; null for one directly under the country. */
  parent: string | null;
}

export interface TerritoryGroup {
  top: Territory;
  /** Every subdivision inside it, at any depth. */
  within: Territory[];
}

/**
 * A country's subdivisions as the picker shows them: those directly under the country by name, each with every one
 * inside it, at any depth, by name (a Spanish community and its provinces; a French region, its departments and
 * theirs). One whose parent isn't listed stands on its own.
 */
export const territoryGroups = (
  territories: readonly Territory[],
  locale: string,
): TerritoryGroup[] => {
  const collator = new Intl.Collator(locale);
  const byName = (a: Territory, b: Territory) => collator.compare(a.name, b.name);
  const byCode = new Map(territories.map((territory) => [territory.code, territory]));
  const topOf = (territory: Territory): Territory => {
    const seen = new Set<string>();
    let current = territory;
    while (current.parent !== null && !seen.has(current.code)) {
      seen.add(current.code);
      const parent = byCode.get(current.parent);
      if (!parent) {
        break;
      }
      current = parent;
    }
    return current;
  };
  const within = new Map<string, Territory[]>();
  const tops: Territory[] = [];
  for (const territory of territories) {
    const top = topOf(territory);
    if (top.code === territory.code) {
      tops.push(territory);
    } else {
      within.set(top.code, [...(within.get(top.code) ?? []), territory]);
    }
  }
  return tops
    .sort(byName)
    .map((top) => ({ top, within: (within.get(top.code) ?? []).sort(byName) }));
};

/** Text as finding compares it: no case, no accents. */
const folded = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The subdivisions whose name or code holds what someone typed, whatever its case and accents, by name. */
export const findTerritories = (
  territories: readonly Territory[],
  query: string,
  locale: string,
): Territory[] => {
  const wanted = folded(query.trim());
  const collator = new Intl.Collator(locale);
  return territories
    .filter(({ code, name }) => folded(name).includes(wanted) || folded(code).includes(wanted))
    .sort((a, b) => collator.compare(a.name, b.name));
};
