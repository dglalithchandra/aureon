/**
 * html2canvas (inside html2pdf.js) cannot parse CSS Color 4 `oklch()` /
 * `oklab()` functions — it throws "Attempting to parse an unsupported color
 * function oklab". Tailwind v4 emits its default palette (emerald, red,
 * amber, slate, white/opacity) in oklch, so any PDF export crashes.
 *
 * Fix: before html2canvas reads the cloned DOM, walk every element and
 * rewrite resolved `oklab()/oklch()` colors to plain `rgb()` inline. Inline
 * styles win over stylesheets, so html2canvas never sees an oklab token.
 *
 * Pure, dependency-free conversion per the CSS Color 4 spec matrices.
 */

function srgbEncode(x: number): number {
  const c = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
}

function oklabToRgb(L: number, a: number, b: number, alpha: number): string {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const R = srgbEncode(r);
  const G = srgbEncode(g);
  const B = srgbEncode(bl);
  return alpha >= 1 ? `rgb(${R}, ${G}, ${B})` : `rgba(${R}, ${G}, ${B}, ${alpha})`;
}

function num(token: string, ref = 1): number {
  const t = token.trim();
  if (t.endsWith("%")) return (parseFloat(t) / 100) * ref;
  return parseFloat(t);
}

/**
 * Replace every oklab()/oklch() occurrence inside an arbitrary CSS value
 * string (handles color, gradients, shadows) with the rgb() equivalent.
 */
export function replaceOklab(value: string): string {
  if (!value || (!value.includes("oklab") && !value.includes("oklch"))) {
    return value;
  }
  return value.replace(/okl(ab|ch)\(\s*([^)]+)\)/gi, (_m, kind: string, body: string) => {
    // body = "L a b" or "L C H" optionally "/ alpha"
    const [main, alphaPart] = body.split("/");
    const parts = (main ?? "").trim().split(/\s+/);
    if (parts.length < 3) return "rgb(0,0,0)";
    const L = num(parts[0]!, 1);
    let a: number;
    let b: number;
    if (kind.toLowerCase() === "ch") {
      const C = num(parts[1]!, 0.4);
      const Hdeg = parseFloat(parts[2]!);
      const h = (Hdeg * Math.PI) / 180;
      a = C * Math.cos(h);
      b = C * Math.sin(h);
    } else {
      a = num(parts[1]!, 0.4);
      b = num(parts[2]!, 0.4);
    }
    const alpha = alphaPart != null ? num(alphaPart, 1) : 1;
    return oklabToRgb(L, a, b, Number.isFinite(alpha) ? alpha : 1);
  });
}

const COLOR_PROPS = [
  "color",
  "backgroundColor",
  "borderTopColor",
  "borderRightColor",
  "borderBottomColor",
  "borderLeftColor",
  "outlineColor",
  "textDecorationColor",
  "fill",
  "stroke",
  "caretColor",
  "columnRuleColor",
] as const;

/**
 * Sweep a cloned document (the one html2canvas hands to its `onclone`
 * callback) and neutralise every oklab/oklch color so the renderer never
 * trips. Gradients and shadows that carry oklab are converted too; if a
 * shadow/gradient still can't be converted cleanly it is dropped (a flat
 * PDF doesn't need it).
 */
export function sanitizeClonedColors(doc: Document): void {
  const all = doc.querySelectorAll<HTMLElement>("*");
  const view = doc.defaultView ?? window;
  all.forEach((el) => {
    let cs: CSSStyleDeclaration;
    try {
      cs = view.getComputedStyle(el);
    } catch {
      return;
    }
    for (const prop of COLOR_PROPS) {
      const v = cs[prop as keyof CSSStyleDeclaration] as unknown as string;
      if (typeof v === "string" && (v.includes("oklab") || v.includes("oklch"))) {
        el.style.setProperty(
          prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`),
          replaceOklab(v),
        );
      }
    }
    // background-image gradients
    const bg = cs.backgroundImage;
    if (bg && (bg.includes("oklab") || bg.includes("oklch"))) {
      el.style.backgroundImage = replaceOklab(bg);
    }
    // box-shadow can carry an oklab color — convert, fall back to none
    const sh = cs.boxShadow;
    if (sh && (sh.includes("oklab") || sh.includes("oklch"))) {
      const conv = replaceOklab(sh);
      el.style.boxShadow =
        conv.includes("oklab") || conv.includes("oklch") ? "none" : conv;
    }
  });
}
