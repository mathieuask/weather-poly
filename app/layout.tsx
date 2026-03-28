import type { Metadata, Viewport } from "next";
import "./globals.css";
import Navbar from "./navbar";

export const metadata: Metadata = {
  title: "Weather Arb",
  description: "Polymarket × GFS+ICON+ECMWF weather arbitrage",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="bg-gray-100 min-h-screen">
        <Navbar />
        <main>
          {children}
        </main>
      </body>
    </html>
  );
}
