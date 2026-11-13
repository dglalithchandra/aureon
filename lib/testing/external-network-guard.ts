import "@/lib/server-only";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function requestUrl(input: Parameters<typeof fetch>[0]): URL {
  if (typeof input === "string") return new URL(input);
  if (input instanceof URL) return input;
  return new URL(input.url);
}

/**
 * Make an E2E server incapable of spending credits or calling real services.
 * This is enabled only by scripts/e2e-server.ts; production never sets the
 * flag. Keeping it at the fetch boundary also catches newly added providers.
 */
export function guardedFetch(delegate: typeof fetch): typeof fetch {
  return (input, init) => {
    const url = requestUrl(input);
    if (!LOOPBACK_HOSTS.has(url.hostname)) {
      return Promise.reject(
        new Error(`External network access is blocked in E2E tests (${url.origin})`),
      );
    }
    return delegate(input, init);
  };
}

export function installExternalNetworkGuard(): void {
  globalThis.fetch = guardedFetch(globalThis.fetch);
}
