"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";

const nav = [
  { href: "/data",      icon: "📊", label: "Data",      desc: "Courbes & prédictions 143 membres" },
  { href: "/strategy",  icon: "🧠", label: "Stratégie", desc: "Signaux & paramètres" },
  { href: "/results",   icon: "📋", label: "Résultats", desc: "Trades passés & P&L" },
];

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      {/* Topbar */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200 sticky top-0 z-30">
        <button
          onClick={() => setOpen(true)}
          className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <span className="font-semibold text-gray-900">🌤 Weather Arb</span>
        <span className="text-xs text-gray-400 hidden sm:block">Polymarket × 143 ensemble members</span>
      </div>

      {/* Overlay sombre */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-40 transition-opacity"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Drawer latéral */}
      <div className={`fixed top-0 left-0 h-full w-72 bg-white z-50 shadow-2xl flex flex-col transition-transform duration-300 ease-in-out ${
        open ? "translate-x-0" : "-translate-x-full"
      }`}>

        {/* Header drawer */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <div className="font-bold text-gray-900 text-base">🌤 Weather Arb</div>
            <div className="text-xs text-gray-400 mt-0.5">Polymarket × 143 ensemble members</div>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {nav.map(item => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${
                  active
                    ? "bg-gray-100 text-gray-900"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                <span className="text-xl">{item.icon}</span>
                <div>
                  <div className={`text-sm font-medium ${active ? "text-gray-900" : ""}`}>{item.label}</div>
                  <div className="text-xs text-gray-400">{item.desc}</div>
                </div>
                {active && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-500" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 text-xs text-gray-400 space-y-1">
          <div>🔄 Scan toutes les 30 min</div>
          <div>📊 GFS + ECMWF + ICON + GEM · 143 membres</div>
          <a
            href="https://github.com/mathieuask/weather-poly"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-gray-600 transition-colors"
          >
            GitHub ↗
          </a>
        </div>
      </div>
    </>
  );
}
