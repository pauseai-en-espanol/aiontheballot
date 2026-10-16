/**
 * A change of the cell's content made from this page (a quote added or removed, a clip, an attestation, a checked
 * document; admin forms §2, PLAN R190): from the version it was sent at, which the API checked under the cell's lock, to
 * the one it left. The draft's form adopts it when its fields were loaded at `from`, keeping what is being typed there;
 * any other change is someone else's, which the form still reports as one (C14).
 */
export interface OwnChange {
  from: number;
  to: number;
}

const EVENT = 'aiontheballot:cell-own-change';

/** The version a change was sent at: its body's `version`, else its address's `?version=`. */
export const sentVersion = (path: string, body: unknown): number | undefined => {
  const fromBody =
    typeof body === 'object' && body !== null ? (body as { version?: unknown }).version : undefined;
  if (typeof fromBody === 'number') {
    return fromBody;
  }
  const query = new URL(path, 'http://admin.invalid').searchParams.get('version');
  return query !== null && /^\d+$/u.test(query) ? Number(query) : undefined;
};

/** The version the API says the change left the cell at. */
export const answeredVersion = (body: unknown): number | undefined => {
  const version =
    typeof body === 'object' && body !== null ? (body as { version?: unknown }).version : undefined;
  return typeof version === 'number' ? version : undefined;
};

/** The version the draft's fields count as loaded at, once `change` is told. */
export const adoptOwnChange = (loaded: number, change: OwnChange): number =>
  loaded === change.from ? change.to : loaded;

/** Tells the page's draft form about a change of this page's own, when the API said where it left the cell. */
export const announceOwnChange = (from: number | undefined, answer: unknown): void => {
  const to = answeredVersion(answer);
  if (from !== undefined && to !== undefined) {
    window.dispatchEvent(new CustomEvent<OwnChange>(EVENT, { detail: { from, to } }));
  }
};

/** Listens for this page's own changes; returns what stops it. */
export const onOwnChange = (listener: (change: OwnChange) => void): (() => void) => {
  const handle = (event: Event) => listener((event as CustomEvent<OwnChange>).detail);
  window.addEventListener(EVENT, handle);
  return () => window.removeEventListener(EVENT, handle);
};
