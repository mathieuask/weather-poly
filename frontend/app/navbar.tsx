"use client";

import Link from "next/link";
import { useState } from "react";

const nav = [
  { href: "/", label: "📡 Signaux" },
  { href: "/results", label: "📋 Résultats" },
];

export default function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200 sticky top-0 z-30">
        <button
          onClick={() => setOpen(!open)}
          className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
          aria-label="Menu"
        >
          {open ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
        <span className="font-bold text-gray-900">🌤 Weather Arb</span>
        <span className="text-xs text-gray-400 hidden sm:block">Polymarket × GFS+ICON+ECMWF</span>
      </div>

      {open && (
        <div className="bg-white border-b border-gray-200 px-4 py-2 flex gap-2 sticky top-12 z-20">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
            >
              {item.label}
            </Link>
          ))}
          <span className="ml-auto text-xs text-gray-400 self-center">Scan 30 min</span>
        </div>
      )}
    </>
  );
}
