/**
 * Canonical key for module-name comparison. Lowercase, strip non-alphanum,
 * strip a common plural "s" so "Notification" and "Notifications" merge.
 *
 * Client-safe on purpose: the chat and the output views compare module names
 * too, so this cannot live behind a server-only import.
 */
export function canonicalModuleKey(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return base.endsWith("s") && base.length > 3 ? base.slice(0, -1) : base;
}
