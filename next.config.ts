import type { NextConfig } from "next";

/**
 * Security headers that are the same for every response.
 *
 * The Content-Security-Policy is not here: it carries a per-request nonce,
 * so `proxy.ts` builds it from `lib/security/csp.ts` (SEC-03). A header set
 * in this file would be a second, weaker policy on the same response.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // Read-only share links are safe to cache briefly. Five minutes is
        // long enough to absorb a Slack/email surge, short enough that an
        // updated final_output (rare — only re-finalize updates it) shows
        // up quickly.
        source: "/share/:token*",
        headers: [{ key: "Cache-Control", value: "public, s-maxage=300, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
