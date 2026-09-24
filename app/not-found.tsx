import { BrandedError } from "@/components/BrandedError";

/**
 * Shown by `notFound()` and for a URL that matches no route.
 *
 * Next renders the unmatched-URL case from a shell it builds ahead of the
 * request, so those scripts carry no CSP nonce and the strict policy blocks
 * them (SEC-03): that page arrives as server-rendered HTML with working
 * links but no hydration. `notFound()` from a real page — a share link that
 * was revoked, a project id that is not yours — renders inside the request
 * and hydrates normally.
 */
export default function NotFound(): React.ReactElement {
  return (
    <BrandedError
      title="Page not found."
      message="The link may have expired, been revoked, or belong to someone else. Your own scopes are on the projects page."
    />
  );
}
