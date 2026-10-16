/**
 * A page's share links (PLAN R177): each network's own address for sharing a link, with the page's canonical address
 * and its title. Plain links, so they work with no script and nothing loads from any network until someone follows
 * one: no widget, no cookie, no request on page load. Instagram and TikTok have no such address; they take the
 * page's data image, in the same panel (SharePanel, PLAN R185).
 */
export const SHARE_NETWORKS = [
  'whatsapp',
  'telegram',
  'x',
  'facebook',
  'bluesky',
  'linkedin',
  'email',
] as const;

export type ShareNetwork = (typeof SHARE_NETWORKS)[number];

/** Query values as %-escapes, spaces as %20: `+` would reach a mail client as a plus sign (RFC 6068). */
const query = (params: Record<string, string>): string =>
  Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');

export const shareLinks = ({
  url,
  text,
}: {
  /** The page's canonical address, from the routing table (never the Host header). */
  url: string;
  /** The page's title. */
  text: string;
}): { network: ShareNetwork; href: string }[] => {
  // Where a network takes one text, the address follows the title in it.
  const both = `${text} ${url}`;
  const href: Record<ShareNetwork, string> = {
    whatsapp: `https://wa.me/?${query({ text: both })}`,
    telegram: `https://t.me/share/url?${query({ url, text })}`,
    x: `https://x.com/intent/post?${query({ text, url })}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?${query({ u: url })}`,
    bluesky: `https://bsky.app/intent/compose?${query({ text: both })}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?${query({ url })}`,
    email: `mailto:?${query({ subject: text, body: url })}`,
  };
  return SHARE_NETWORKS.map((network) => ({ network, href: href[network] }));
};
