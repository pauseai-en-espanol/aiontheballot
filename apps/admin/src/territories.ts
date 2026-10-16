import { iso31662 } from 'iso-3166';

import type { Territory } from './ui/territory-tree';

/**
 * The subdivisions of a site's country, from ISO 3166-2 as the pinned `iso-3166` package lists them (PLAN R201), for
 * the territory picker. None for a code ISO keeps for private use, such as a demo site's XA, whose forms keep the code
 * field. Read on the server: a page passes only its site's country's subdivisions to its forms.
 */
export const territoriesOf = (countryCode: string): Territory[] =>
  iso31662
    .filter(({ code }) => code.startsWith(`${countryCode}-`))
    .map(({ code, name, parent }) => ({
      code,
      name,
      parent: parent === countryCode ? null : parent,
    }));
