import type { Metadata } from "next";
import "./globals.css";
import Navbar from "./navbar";

export const metadata: Metadata = {
  title: "Weather Arb",
  description: "Polymarket × GFS+ICON+ECMWF weather arbitrage",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="bg-gray-100 min-h-screen">
        <Navbar />
        <main className="max-w-2xl mx-auto px-2 py-4">
          {children}
        </main>
      </body>
    </html>
  );
}
