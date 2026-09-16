import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "RPG Fuel",
  description: "Royalty Petroleums Group fuel operations: orders, pricing, loads, BOLs, billing, and profitability, with a built-in copilot.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
