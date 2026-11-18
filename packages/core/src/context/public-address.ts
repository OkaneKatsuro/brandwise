// Which IP addresses belong to the public internet. The address of a site to read comes from outside, so it is only ever
// requested when it is public: everything else is this machine, the network around it or a cloud's metadata service.
import { BlockList, isIP } from "node:net";

type Network = readonly [address: string, bits: number];

/** IPv4 networks that are not the public internet (IANA special-purpose registry). */
const NOT_PUBLIC_V4: readonly Network[] = [
  ["0.0.0.0", 8],        // "this network"
  ["10.0.0.0", 8],       // private
  ["100.64.0.0", 10],    // carrier-grade NAT
  ["127.0.0.0", 8],      // loopback
  ["169.254.0.0", 16],   // link-local, where clouds serve instance metadata (169.254.169.254)
  ["172.16.0.0", 12],    // private
  ["192.0.0.0", 24],     // protocol assignments
  ["192.0.2.0", 24],     // documentation
  ["192.168.0.0", 16],   // private
  ["198.18.0.0", 15],    // benchmarking
  ["198.51.100.0", 24],  // documentation
  ["203.0.113.0", 24],   // documentation
  ["224.0.0.0", 4],      // multicast
  ["240.0.0.0", 4],      // reserved, broadcast
];
/**
 * IPv6 is judged the other way round, because most of its space is not the public internet: an address is public only inside
 * these networks. Loopback, unique local, link-local, site-local, multicast, the translation prefixes a network keeps for itself
 * and whatever is defined later are outside them without being named.
 */
const PUBLIC_V6: readonly Network[] = [
  ["2000::", 3],         // global unicast: every address that is given out to a network
  ["::ffff:0:0", 96],    // IPv4-mapped (::ffff:a.b.c.d): as public as the IPv4 address it carries
  ["64:ff9b::", 96],     // NAT64 (64:ff9b::a.b.c.d): an IPv4 address reached through a translator, as public as that address
];
/** Networks inside the global unicast space that are not the public internet either (IANA special-purpose registry). */
const NOT_PUBLIC_V6: readonly Network[] = [
  ["2001::", 23],        // protocol assignments: Teredo, benchmarking, ORCHID
  ["2001:db8::", 32],    // documentation
  ["2002::", 16],        // 6to4: an IPv4 address in an IPv6 one, and nothing public is served from it
  ["3fff::", 20],        // documentation
];

const publicV6 = new BlockList(), notPublic = new BlockList();
for (const [network, bits] of PUBLIC_V6) publicV6.addSubnet(network, bits, "ipv6");
for (const [network, bits] of NOT_PUBLIC_V4) {
  notPublic.addSubnet(network, bits, "ipv4");
  // The same network behind NAT64. The IPv4-mapped form needs no entry: BlockList reads it as the IPv4 address it carries.
  notPublic.addSubnet(`64:ff9b::${network}`, 96 + bits, "ipv6");
}
for (const [network, bits] of NOT_PUBLIC_V6) notPublic.addSubnet(network, bits, "ipv6");

/** Whether `ip` (IPv4 or IPv6, as text) is an address of the public internet. Text that is no IP address is not. */
export function isPublicAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 0) return false;
  return version === 4 ? !notPublic.check(ip, "ipv4") : publicV6.check(ip, "ipv6") && !notPublic.check(ip, "ipv6");
}
