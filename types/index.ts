/**
 * Shared types entry point. Domain-specific types live next to their
 * schemas under `lib/schemas/*` and are re-exported here as needed.
 */

export type Brand<T, B extends string> = T & { readonly __brand: B };
export type SessionId = Brand<string, "SessionId">;
export type ParameterId =
  | "P-01"
  | "P-02"
  | "P-03"
  | "P-04"
  | "P-05"
  | "P-06"
  | "P-07"
  | "P-08"
  | "P-09";
