import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Weather Arb",
  description: "Polymarket × GFS weather arbitrage",
};

const nav = [
  { href: "/", label: "📡 Signaux" },
  { href: "/results", label: "📋 Résultats" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="bg-gray-50 min-h-screen">
        <div className="flex min-h-screen">
          {/* Sidebar */}
          <aside className="w-48 bg-white border-r border-gray-200 flex flex-col shrink-0 sticky top-0 h-screen">
            <div className="px-4 py-5 border-b border-gray-100">
              <div className="text-lg font-bold text-gray-900">🌤 Weather Arb</div>
              <div className="text-xs text-gray-400 mt-0.5">Polymarket × GFS</div>
            </div>
            <nav className="flex-1 px-2 py-4 space-y-1">
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="px-4 py-3 border-t border-gray-100 text-xs text-gray-400">
              Scan toutes les 6h
            </div>
          </aside>

          {/* Contenu */}
          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
