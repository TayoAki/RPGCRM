import "./globals.css";
import type { Metadata } from "next";
import { Open_Sans, Poppins } from "next/font/google";

// Brand type from the company site: Poppins for headings, Open Sans for body copy.
// next/font self-hosts the files at build time, so nothing is fetched from Google at runtime.
const openSans = Open_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], style: ["normal", "italic"], variable: "--font-open-sans", display: "swap" });
const poppins = Poppins({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-poppins", display: "swap" });

export const TAGLINE = "Royalty Petroleums Group delivers cost-effective wholesale fuel solutions with reliable supply, competitive pricing, and expert logistics management.";

export const metadata: Metadata = {
  title: { default: "RPG Fuel Platform · Royalty Petroleums Group", template: "%s · RPG Fuel Platform" },
  description: TAGLINE,
  applicationName: "RPG Fuel Platform",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`h-full ${openSans.variable} ${poppins.variable}`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
