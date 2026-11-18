import { describe, expect, it } from "vitest";
import { isPublicNetworkAddress } from "@/lib/security/public-download";

describe("public network download guard", () => {
  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "198.51.100.10",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
  ])("blocks non-public address %s", (address) => {
    expect(isPublicNetworkAddress(address)).toBe(false);
  });

  it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])(
    "allows public address %s",
    (address) => {
      expect(isPublicNetworkAddress(address)).toBe(true);
    },
  );

  it("rejects values that are not IP addresses", () => {
    expect(isPublicNetworkAddress("localhost")).toBe(false);
  });
});
