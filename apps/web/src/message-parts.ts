/** Marks a value's place in a formatted message: Unicode's private use area, which no message or content holds. */
const mark = (index: number) => `${index}`;

/**
 * A translated message cut around some of its values, so each can be an element of its own (a name with its own
 * `lang`, WCAG 3.1.2): the message is formatted with a marker for each value, then cut at the markers. Text pieces are
 * strings; a value's place is `{ part }`, its name.
 */
export const messageParts = <K extends string>(
  format: (values: Record<K, string>) => string,
  names: readonly K[],
): (string | { part: K })[] => {
  const values = Object.fromEntries(names.map((name, index) => [name, mark(index)])) as Record<
    K,
    string
  >;
  return format(values)
    .split(/(\d+)/u)
    .flatMap<string | { part: K }>((piece, index) => {
      if (index % 2 === 0) {
        return piece === '' ? [] : [piece];
      }
      const name = names[Number(piece)];
      return name === undefined ? [] : [{ part: name }];
    });
};
