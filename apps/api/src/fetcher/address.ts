import { BlockList, isIP } from 'node:net';

/**
 * The addresses the fetcher may connect to for a member's URL (ADR-0007 §2): the public internet only. Its
 * NetworkPolicy says the same, but a policy can't see names, so every address a URL's name resolves to is checked
 * here too, in the connection's own lookup.
 */

const NOT_PUBLIC = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // shared (carrier-grade NAT)
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relays
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
] as const) {
  NOT_PUBLIC.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['64:ff9b::', 96], // NAT64, which embeds an IPv4 address
  ['64:ff9b:1::', 48], // local NAT64
  ['2001::', 32], // Teredo
  ['2001:2::', 48], // benchmarking
  ['2001:10::', 28], // ORCHID
  ['2001:20::', 28], // ORCHIDv2
  ['2001:db8::', 32], // documentation
  ['3fff::', 20], // documentation
  ['2002::', 16], // 6to4, which embeds an IPv4 address
] as const) {
  NOT_PUBLIC.addSubnet(network, prefix, 'ipv6');
}

/** IPv6's global unicast range: everything else (loopback, link-local, unique local, multicast) is not public. */
const GLOBAL_UNICAST = new BlockList();
GLOBAL_UNICAST.addSubnet('2000::', 3, 'ipv6');

/** An IPv4 address written as IPv6 (`::ffff:10.0.0.1`), as the IPv4 address it is. */
const MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/iu;

/** Whether an address (as `dns.lookup` gives it) is on the public internet. Anything that isn't an address is not. */
export const isPublicAddress = (address: string): boolean => {
  const mapped = MAPPED.exec(address)?.[1];
  const ip = mapped ?? address;
  const family = isIP(ip);
  if (family === 4) {
    return !NOT_PUBLIC.check(ip, 'ipv4');
  }
  if (family === 6) {
    // `::ffff:a00:1`, the mapped form in hex: outside 2000::/3, so refused below like every other special range.
    return GLOBAL_UNICAST.check(ip, 'ipv6') && !NOT_PUBLIC.check(ip, 'ipv6');
  }
  return false;
};
