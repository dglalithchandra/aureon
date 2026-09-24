import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { OutputCards } from "@/components/landing/OutputCards";
import { TechStack } from "@/components/landing/TechStack";
import { CTA } from "@/components/landing/CTA";
import { connection } from "next/server";

/**
 * Rendered per request, not at build time: the strict CSP puts a fresh
 * nonce on every script tag, and a page prerendered at build time has no
 * request to take one from (SEC-03).
 */
export default async function Home(): Promise<React.ReactElement> {
  await connection();
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
