import type { Metadata } from "next";
import {
  Outfit,
  Playfair_Display,
  JetBrains_Mono,
  Bricolage_Grotesque,
  Instrument_Serif,
} from "next/font/google";
import "./globals.css";
import { SkeletonKeyframes } from "@/components/Skeleton";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  display: "swap",
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  display: "swap",
  weight: ["700", "800", "900"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

// Premium variable display font — used for hero + section headlines.
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  display: "swap",
});

// Italic accent serif for tasteful inline emphasis.
const instrument = Instrument_Serif({
  variable: "--font-instrument",
  subsets: ["latin"],
  display: "swap",
  weight: ["400"],
  style: ["italic", "normal"],
});

export const metadata: Metadata = {
  title: "ScopeAI — Turn raw client requirements into engineer-ready scope",
  description:
    "Paste raw client requirements and get a structured project summary, validated against real-world GitHub repositories, with a two-stage approval flow for clients and engineers.",
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): React.ReactElement {
  return (
    <html
      lang="en"
      className={`${outfit.variable} ${playfair.variable} ${jetbrainsMono.variable} ${bricolage.variable} ${instrument.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <link
          rel="preconnect"
          href="https://api.anthropic.com"
          crossOrigin="anonymous"
        />
        <link rel="preconnect" href="https://api.github.com" />
      </head>
      <body className="bg-blueprint-bg text-blueprint-text flex min-h-full flex-col font-sans">
        <SkeletonKeyframes />
        {children}
      </body>
    </html>
  );
}
