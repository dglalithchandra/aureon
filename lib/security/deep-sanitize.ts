import "@/lib/server-only";
import { stripHtml } from "@/lib/security/sanitize";

/**
 * Deeply walk an object/array tree and run `stripHtml` on every string. The
 * structure shape is preserved exactly — keys aren't renamed, arrays stay
 * arrays — so the result still validates against the FinalOutput Zod schema
 * after sanitization.
 *
 * Used right before persisting any user-edited output. Defense-in-depth on
 * top of Zod string-length caps and react-markdown's render-time sanitize.
 */
export function deepSanitize<T>(value: T): T {
  if (typeof value === "string") {
    return stripHtml(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => deepSanitize(v)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = deepSanitize(v);
    }
    return out as T;
  }
  return value;
}
