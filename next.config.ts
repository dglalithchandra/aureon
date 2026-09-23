import type { NextConfig } from "next";

/**
 * Strict CSP for Aureon.
 *
 * Notes on `'unsafe-inline'` for script-src:
 *   - Required by Next.js inline runtime hydration scripts in dev (replaced
 *     with nonces in a future hardening pass) AND by the @splinetool/runtime
 *     loader which injects a small inline bootstrap.
 *   - `connect-src` allow-listing limits where the app may exfiltrate data,
 *     reducing impact even if `unsafe-inline` were exploited.
 *
 * `connect-src` allow-list:
 *   - generativelanguage.googleapis.com — Gemini (server-only, listed for safety)
 *   - api.github.com      — Octokit
 *   - prod.spline.design  — Spline scene assets
 */
const cspDirectives: Record<string, string[]> = {
  "default-src": ["'self'"],
  "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
  "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  "img-src": [
    "'self'",
    "data:",
    "blob:",
    "https://avatars.githubusercontent.com",
    "https://raw.githubusercontent.com",
    "https://prod.spline.design",
  ],
  "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
  "connect-src": [
    "'self'",
    "https://generativelanguage.googleapis.com",
    "https://api.github.com",
    "https://prod.spline.design",
    "https://*.upstash.io",
  ],
  "frame-ancestors": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "object-src": ["'none'"],
  "worker-src": ["'self'", "blob:"],
};

function buildCsp(): string {
  return Object.entries(cspDirectives)
    .map(([directive, values]) => `${directive} ${values.join(" ")}`)
    .join("; ");
}

const securityHeaders = [
  { key: "Content-Security-Policy", value: buildCsp() },
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
