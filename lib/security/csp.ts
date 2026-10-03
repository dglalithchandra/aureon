/**
 * The Content-Security-Policy, built per request (SEC-03).
 *
 * It lives here rather than in `next.config.ts` because a strict policy
 * needs a nonce, and a nonce has to be new for every response. `proxy.ts`
 * generates one, puts it in this policy and in the `x-nonce` request header;
 * Next.js reads the policy back, finds the nonce and stamps it on every
 * script it renders.
 *
 * What the browser is allowed to reach is deliberately short: the app's own
 * origin, Google Fonts for the typefaces, Spline for the landing scene, and
 * GitHub's avatar and raw hosts for images. The model and GitHub APIs are
 * called from the server and never appear here.
 *
 * One known limit, measured against a real production build. A page Next
 * serves from its own response cache keeps the nonce it was rendered with,
 * while this policy is rebuilt per request — so the two do not match and
 * that page's scripts are blocked. It affects only pages with no
 * request-dependent data: `/privacy`, `/terms` and the 404 for a URL that
 * matches no route. They arrive as correct server-rendered HTML with
 * working links and no hydration. Every page that renders data — the
 * landing page, the chat, a scope, a share link, the projects list — is
 * rendered per request and matches. `force-dynamic`, `connection()`,
 * `headers()`, `searchParams` and a proxy rewrite to a dynamic page were
 * each tried on Next 16.3.5 and none stopped the caching; the alternative
 * is dropping the nonce and allowing inline scripts everywhere, which is
 * the thing SEC-03 was about. To re-measure: build, `next start`, then
 * compare the `nonce-` in the response header with the first `nonce="` in
 * the body for each page.
 *
 * `'unsafe-eval'` is development only: React uses `eval` there to rebuild
 * server stacks in the browser. Neither React nor Next needs it in a
 * production build, so it is not granted in one.
 */

export interface CspOptions {
  nonce: string;
  dev: boolean;
}

export function buildCsp({ nonce, dev }: CspOptions): string {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    // Scripts loaded by an already-trusted script (Next's chunk loader,
    // Spline's runtime) inherit the trust; the host allow-list below is the
    // fallback for browsers that do not understand strict-dynamic.
    "'strict-dynamic'",
    "https:",
    ...(dev ? ["'unsafe-eval'"] : []),
  ];

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": scriptSrc,
    // Styles stay on 'unsafe-inline': Tailwind's runtime-inserted styles and
    // framer-motion's animated `style` attributes are not nonce-able, and an
    // injected stylesheet cannot run code.
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
    "connect-src": ["'self'", "https://prod.spline.design"],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "object-src": ["'none'"],
    "worker-src": ["'self'", "blob:"],
  };

  const policy = Object.entries(directives)
    .map(([directive, values]) => `${directive} ${values.join(" ")}`)
    .join("; ");
  // The dev server streams over http on localhost, so upgrading every
  // request to https would break it.
  return dev ? policy : `${policy}; upgrade-insecure-requests`;
}

/** A fresh, unguessable nonce for one response. */
export function newNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}
