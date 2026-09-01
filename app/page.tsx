import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { OutputCards } from "@/components/landing/OutputCards";
import { TechStack } from "@/components/landing/TechStack";
import { CTA } from "@/components/landing/CTA";

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
