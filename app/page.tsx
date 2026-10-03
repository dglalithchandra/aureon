import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { OutputCards } from "@/components/landing/OutputCards";
import { TechStack } from "@/components/landing/TechStack";
import { CTA } from "@/components/landing/CTA";

/**
 * Never cached, always rendered for the request that asked for it. The
 * strict CSP puts a fresh nonce on every script tag (SEC-03), and a page
 * served from the full route cache would carry the nonce of whoever
 * rendered it first — which matches no later response's header, so every
 * script on it is blocked. `connection()` alone did not prevent that.
 */
export const dynamic = "force-dynamic";

/**
 * Rendered per request, not at build time: the strict CSP puts a fresh
 * nonce on every script tag, and a page prerendered at build time has no
 * request to take one from (SEC-03).
 */
export default function Home(): React.ReactElement {
  return (
    <main className="bg-blueprint-bg flex min-h-screen flex-col">
      <Hero />
      <HowItWorks />
      <OutputCards />
      <TechStack />
      <CTA />
    </main>
  );
}
