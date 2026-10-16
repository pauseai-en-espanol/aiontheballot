/** A colour as the database keeps it: `#rrggbb`, in lowercase. */
export const COLOUR = /^#[\da-f]{6}$/u;

/** What was typed as a colour's code, as the database would keep it: lowercase, with its `#`. */
export const colourCode = (typed: string): string => {
  const trimmed = typed.trim().toLowerCase();
  return trimmed === '' || trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
};
