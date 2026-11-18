import "@/lib/server-only";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

/**
 * Network ranges that a server-side, user-configured URL must never reach.
 * Besides RFC1918, this includes loopback, link-local, carrier NAT,
 * documentation, benchmarking, multicast and otherwise reserved ranges.
 */
const blockedAddresses = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv6");
}

export function isPublicNetworkAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedAddresses.check(address, "ipv4");
  if (family === 6) {
    if (address.toLowerCase().startsWith("::ffff:")) return false;
    return !blockedAddresses.check(address, "ipv6");
  }
  return false;
}

async function resolvePublicAddress(hostname: string): Promise<{
  address: string;
  family: 4 | 6;
}> {
  const literal = hostname.replace(/^\[|\]$/g, "");
  const family = isIP(literal);
  const resolved = family
    ? [{ address: literal, family: family as 4 | 6 }]
    : await lookup(literal, { all: true, verbatim: true });

  if (
    resolved.length === 0 ||
    resolved.some(({ address }) => !isPublicNetworkAddress(address))
  ) {
    throw new Error("Remote URL resolves to a blocked network address");
  }
  const selected = resolved[0]!;
  return {
    address: selected.address,
    family: selected.family === 6 ? 6 : 4,
  };
}

export interface PublicDownload {
  contentType: string;
  data: Uint8Array;
}

/**
 * Download a small HTTPS resource without permitting redirects or DNS
 * rebinding. DNS is resolved and checked once, then the request is pinned to
 * that exact public address while TLS still verifies the original hostname.
 */
export async function downloadPublicHttps(
  input: URL,
  options: { maxBytes: number; timeoutMs: number },
): Promise<PublicDownload> {
  if (
    input.protocol !== "https:" ||
    input.username !== "" ||
    input.password !== "" ||
    (input.port !== "" && input.port !== "443")
  ) {
    throw new Error("Remote URL must use HTTPS on the standard port");
  }

  const pinned = await resolvePublicAddress(input.hostname);
  const pinnedLookup: LookupFunction = (_hostname, lookupOptions, callback) => {
    if (lookupOptions.all) {
      callback(null, [pinned]);
      return;
    }
    callback(null, pinned.address, pinned.family);
  };

  return new Promise<PublicDownload>((resolve, reject) => {
    const req = request(
      input,
      {
        headers: { Accept: "image/png,image/jpeg,image/gif,image/bmp" },
        lookup: pinnedLookup,
      },
      (res) => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          reject(new Error(`Remote server returned ${res.statusCode ?? "no status"}`));
          return;
        }

        const declaredLength = Number(res.headers["content-length"] ?? 0);
        if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
          res.destroy(new Error("Remote response exceeds the size limit"));
          return;
        }

        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.byteLength;
          if (total > options.maxBytes) {
            res.destroy(new Error("Remote response exceeds the size limit"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          if (total === 0) {
            reject(new Error("Remote response was empty"));
            return;
          }
          resolve({
            contentType: res.headers["content-type"] ?? "",
            data: new Uint8Array(Buffer.concat(chunks, total)),
          });
        });
        res.on("error", reject);
      },
    );

    req.setTimeout(options.timeoutMs, () => {
      req.destroy(new Error("Remote request timed out"));
    });
    req.on("error", reject);
    req.end();
  });
}
