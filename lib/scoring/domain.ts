import { SCOPING } from "@/lib/config/scoping";

/**
 * The domain label the model writes is free text ("B2B SaaS for agencies",
 * "Healthcare / telemedicine"), while the config tables are keyed by the
 * blueprint's nine domains. This maps one to the other.
 *
 * Client-safe: the module scoring (step 07), the effort engine (step 10),
 * the risk engine (step 09) and the output views all need it.
 */

/** A key of SCOPING.domainModules, or null when the label means none of them. */
export function domainKey(domain: string): string | null {
  const compact = domain
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join("");
  if (!compact) return null;

  for (const key of Object.keys(SCOPING.domainModules)) {
    if (compact.includes(key.replace(/[^a-z0-9]/g, ""))) return key;
  }
  // "E-Commerce" → "ecommerce", "Internal Tool" → "internal-tools", and so on.
  if (compact.includes("commerce")) return "ecommerce";
  if (compact.includes("internal")) return "internal-tools";
  if (compact.includes("content")) return "cms";
  if (compact.includes("education") || compact.includes("learning")) return "edtech";
  if (compact.includes("health") || compact.includes("clinic")) return "healthcare";
  return null;
}
