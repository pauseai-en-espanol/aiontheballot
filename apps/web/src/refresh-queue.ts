/**
 * One refresh at a time per key, for the public data's loaders (PLAN R151). A load that finds its copy too old joins
 * the refresh on its way, or starts one. A forced load (the API's word that something changed, perhaps after the
 * running refresh began) gets a refresh that starts after it was asked for, shared by every force that comes before
 * it starts: so a burst of forces costs at most two fetches, and since a key's refreshes never overlap, an older answer
 * never overwrites a newer one.
 */
export const createRefreshQueue = <K>(refresh: (key: K) => Promise<void>) => {
  const slots = new Map<K, { running: Promise<void>; queued?: Promise<void> }>();

  const begin = (key: K): Promise<void> => {
    const running: Promise<void> = refresh(key).finally(() => {
      const slot = slots.get(key);
      if (slot?.running === running && slot.queued === undefined) {
        slots.delete(key);
      }
    });
    slots.set(key, { running });
    return running;
  };

  return {
    /** The refresh on its way, or a new one. */
    join: (key: K): Promise<void> => slots.get(key)?.running ?? begin(key),
    /** A refresh that starts after this call: the one already waiting, or one after the running one, or now. */
    force: (key: K): Promise<void> => {
      const slot = slots.get(key);
      if (!slot) {
        return begin(key);
      }
      slot.queued ??= slot.running.catch(() => undefined).then(() => begin(key));
      return slot.queued;
    },
  };
};
