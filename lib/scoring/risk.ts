import { SCOPING } from "@/lib/config/scoping";
import { domainKey } from "@/lib/scoring/domain";
import type { ExtractionResult } from "@/lib/schemas/extraction";
import type { RiskSeverity } from "@/lib/schemas/output";

/**
 * Risk detection (blueprint step 09) — pattern matching on the module list,
 * the parameter states and the domain. Deterministic: the same extraction
 * always produces the same risks with the same severities. The model may
 * rewrite the wording of a risk, never its severity or whether it fires
 * (see lib/pipeline/finalize.ts).
 *
 * Not implemented from the blueprint: the GitHub-sourced rules (team size of
 * matched repos, security-labelled issues), which need data the enrichment
 * does not collect.
 */

export const RISK_RULE_IDS = [
  "scope-explosion",
  "realtime-infra",
  "integrations-unspecified",
  "multi-platform",
  "domain-compliance",
] as const;
export type RiskRuleId = (typeof RISK_RULE_IDS)[number];

export interface DetectedRisk {
  rule_id: RiskRuleId;
  severity: RiskSeverity;
  description: string;
}

/** Everything a rule may read: what the modules say and what the evidence says. */
function haystack(extraction: ExtractionResult): string {
  const parts = [extraction.domain];
  for (const m of extraction.modules) {
    parts.push(m.name, m.description, m.source_signal);
  }
  for (const p of extraction.parameters) {
    if (p.evidence) parts.push(p.evidence);
  }
  return parts.join(" \n ").toLowerCase();
}

/** The needles found in the text, in the order they are listed. */
function found(text: string, needles: readonly string[]): string[] {
  return needles.filter((n) => text.includes(n));
}

/** "chat" and "live tracking" → "chat, live tracking". */
function list(items: readonly string[]): string {
  return items.join(", ");
}

const REALTIME = [
  "websocket",
  "web socket",
  "socket.io",
  "real-time",
  "realtime",
  "live tracking",
  "live location",
  "live updates",
  "chat",
  "streaming",
] as const;

const PAYMENTS = [
  "payment",
  "checkout",
  "billing",
  "invoice",
  "subscription",
  "payout",
  "refund",
] as const;

const NOTIFICATIONS = [
  "notification",
  "notify",
  "email",
  "sms",
  "whatsapp",
  "push",
  "alert",
  "reminder",
] as const;

/**
 * A separate mobile client, not "it should work on phones" — a responsive
 * web app is one build, and flagging it as two would be wrong.
 */
const MOBILE_APP = [
  "mobile app",
  "native app",
  "android",
  "ios ",
  "iphone",
  "react native",
  "flutter",
  "play store",
  "app store",
  "offline sync",
  "push notification",
] as const;

const WEB_APP = [
  "web app",
  "web platform",
  "web board",
  "website",
  "browser",
  "web dashboard",
  "admin panel",
  "portal",
  "next.js",
  "desktop",
] as const;

/** Every risk this extraction triggers, most severe first. */
export function detectRisks(extraction: ExtractionResult): DetectedRisk[] {
  const text = haystack(extraction);
  const risks: DetectedRisk[] = [];

  const moduleCount = extraction.modules.length;
  if (moduleCount > SCOPING.scopeExplosionModules) {
    risks.push({
      rule_id: "scope-explosion",
      severity: "WARNING",
      description: `Scope appears to exceed team capacity: ${moduleCount} modules, past the ${SCOPING.scopeExplosionModules} where delivery risk climbs. Consider phasing the build and cutting the first release.`,
    });
  }

  const realtime = found(text, REALTIME);
  if (realtime.length > 0) {
    risks.push({
      rule_id: "realtime-infra",
      severity: "WARNING",
      description: `Real-time features (${list(realtime.slice(0, 3))}) need WebSocket infrastructure. Budget for connection management, reconnection handling and the cost of scaling those connections.`,
    });
  }

  const integrationsMissing =
    extraction.parameters.find((p) => p.id === "P-05")?.state === "MISSING";
  if (integrationsMissing) {
    const payments = found(text, PAYMENTS);
    const notifications = found(text, NOTIFICATIONS);
    if (payments.length > 0) {
      // Payments decide architecture and compliance, so this one blocks.
      risks.push({
        rule_id: "integrations-unspecified",
        severity: "CRITICAL",
        description: `Money moves through this scope (${list(payments.slice(0, 3))}) but no provider is named (P-05 is MISSING). Stripe and Razorpay differ in compliance, payout timing and webhook design, so the choice changes the build. Decide before estimating.`,
      });
    } else if (notifications.length > 0) {
      // A messaging provider can be swapped late: a decision, not a blocker.
      risks.push({
        rule_id: "integrations-unspecified",
        severity: "WARNING",
        description: `Notifications are in scope (${list(notifications.slice(0, 3))}) but no provider is named (P-05 is MISSING). Deliverability, templates and per-message cost all depend on that choice, so make it before the build starts.`,
      });
    }
  }

  // "react native" would otherwise match the web list through "react".
  const webText = text.split("react native").join(" ");
  const mobile = found(text, MOBILE_APP);
  const web = found(webText, WEB_APP);
  if (mobile.length > 0 && web.length > 0) {
    risks.push({
      rule_id: "multi-platform",
      severity: "WARNING",
      description: `Both a mobile app (${list(mobile.slice(0, 2))}) and a web build (${list(web.slice(0, 2))}) are in scope. Building both at once is about 2.5× the work of either. Consider mobile-first or web-first for release one.`,
    });
  }

  const key = domainKey(extraction.domain);
  if (key !== null && SCOPING.complianceDomains.includes(key)) {
    risks.push({
      rule_id: "domain-compliance",
      severity: "WARNING",
      description:
        key === "fintech"
          ? "FinTech scope: KYC, AML and data-retention obligations apply whether or not they were discussed. Get the regulatory position agreed in writing before the build starts — retrofitting it is expensive."
          : "Healthcare scope: HIPAA (or the local equivalent) governs how patient data is stored, logged and shared, whether or not it was discussed. Agree the compliance position before the build starts.",
    });
  }

  const order: Record<RiskSeverity, number> = { CRITICAL: 0, WARNING: 1, NOTE: 2 };
  return risks.sort((a, b) => order[a.severity] - order[b.severity]);
}
