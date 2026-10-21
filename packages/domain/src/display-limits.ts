/**
 * How many parties and criteria an election's summary and share images are made for (PLAN R221): past these, the
 * admin warns before the election goes live, since the table gets crowded and a link's preview shows only the first
 * parties. A warning, never a rule: an election may need more, and every view still draws them all, never cut.
 */
export const DISPLAY_LIMITS = { parties: 16, criteria: 12 } as const;
