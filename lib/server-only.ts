/**
 * Server-only guard. Importing this module from a client bundle throws
 * at runtime; in a Node / Next server context it is a no-op.
 *
 * Why we use this instead of the npm `server-only` package:
 *   - `server-only` always throws when imported outside the Next bundler,
 *     which breaks tsx test scripts even though they ARE server code.
 *   - Our check inspects `window` — present in browser bundles, absent in
 *     both Next server and Node CLI — and is functionally equivalent.
 *
 * Always import this as the FIRST line of any module that must not be
 * bundled to the client (anything that touches the model provider, GitHub, env, or
 * Redis credentials).
 */
if (typeof window !== "undefined") {
  throw new Error(
    "This module is server-only and must not be imported from a client bundle.",
  );
}

export {};
