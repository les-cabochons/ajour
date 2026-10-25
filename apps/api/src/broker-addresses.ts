import { BlockList, isIP } from "node:net";

/*
 * The addresses the broker never sends to unless the user marked the
 * connection as on-premises: this computer, the local network and anything
 * that isn't a public unicast address. Decided in #219 and the spec #381.
 */

const PRIVATE_IPV4: readonly [string, number][] = [
  ["0.0.0.0", 8], // "this network", 0.0.0.0 included
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local
  ["172.16.0.0", 12],
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, and the broadcast address
];

const PRIVATE_IPV6: readonly [string, number][] = [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["::ffff:0:0", 96], // IPv4-mapped: refused whole, whatever it maps
  ["::", 96], // IPv4-compatible, deprecated
  ["64:ff9b:1::", 48], // local-use NAT64
  ["100::", 64], // discard-only
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local, deprecated
  ["ff00::", 8], // multicast
];

// Two lists: one list checks an IPv4 address against its IPv6 rules too,
// as the IPv4-mapped form, which the IPv6 list refuses whole.
const blockedIpv4 = new BlockList();
for (const [address, prefix] of PRIVATE_IPV4) {
  blockedIpv4.addSubnet(address, prefix, "ipv4");
}
const blockedIpv6 = new BlockList();
for (const [address, prefix] of PRIVATE_IPV6) {
  blockedIpv6.addSubnet(address, prefix, "ipv6");
}

/** The IPv4 address an IPv6 form embeds, for NAT64 and 6to4. */
function embeddedIpv4(address: string): string | undefined {
  const groups = expandIpv6(address);
  if (!groups) return undefined;
  const fromGroups = (high: number, low: number) =>
    [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
  // 64:ff9b::/96, the well-known NAT64 prefix.
  if (
    groups[0] === 0x64 &&
    groups[1] === 0xff9b &&
    groups.slice(2, 6).every((group) => group === 0)
  ) {
    return fromGroups(groups[6]!, groups[7]!);
  }
  // 2002::/16, 6to4.
  if (groups[0] === 0x2002) return fromGroups(groups[1]!, groups[2]!);
  return undefined;
}

function expandIpv6(address: string): number[] | undefined {
  let text = address.toLowerCase();
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);
  // A dotted IPv4 tail, as in ::ffff:1.2.3.4.
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (tail) {
    const parts = tail[1]!.split(".").map(Number);
    text = `${text.slice(0, -tail[1]!.length)}${((parts[0]! << 8) | parts[1]!).toString(16)}:${((parts[2]! << 8) | parts[3]!).toString(16)}`;
  }
  const [head, rest] = text.split("::") as [string, string | undefined];
  const left = head ? head.split(":") : [];
  const right = rest ? rest.split(":") : [];
  const missing = 8 - left.length - right.length;
  if (rest === undefined ? missing !== 0 : missing < 0) return undefined;
  const groups = [
    ...left,
    ...Array.from({ length: rest === undefined ? 0 : missing }, () => "0"),
    ...right,
  ].map((group) => Number.parseInt(group, 16));
  return groups.length === 8 && groups.every((group) => group >= 0)
    ? groups
    : undefined;
}

/** An address literal without the brackets a URL host puts around IPv6. */
export function unbracketed(host: string) {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/** Whether `host`, as a URL holds it, is an IP address literal. */
export function isAddressLiteral(host: string) {
  return isIP(unbracketed(host)) !== 0;
}

/**
 * Whether the broker refuses the address without on-premises: loopback,
 * private, link-local, unique local, carrier-grade NAT, unspecified,
 * multicast, reserved and documentation ranges, and every IPv4-mapped IPv6
 * address. An address that isn't one at all counts as private, so a
 * resolver's odd answer fails closed.
 */
export function isPrivateAddress(address: string): boolean {
  const literal = unbracketed(address.trim());
  const family = isIP(literal.split("%")[0]!);
  if (family === 4) return blockedIpv4.check(literal, "ipv4");
  if (family !== 6) return true;
  const plain = literal.split("%")[0]!;
  if (blockedIpv6.check(plain, "ipv6")) return true;
  const embedded = embeddedIpv4(plain);
  return embedded !== undefined && blockedIpv4.check(embedded, "ipv4");
}
