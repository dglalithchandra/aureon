import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** A short project title: the first sentence of the raw input. */
export function deriveTitle(rawInput: string): string {
  const trimmed = rawInput.trim().split(/\n|\.|!|\?/)[0] ?? "";
  const cleaned = trimmed.replace(/\s+/g, " ").trim();
  if (!cleaned) return "Untitled scope";
  return cleaned.length > 80 ? cleaned.slice(0, 77) + "…" : cleaned;
}
