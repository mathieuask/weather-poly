import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import path from "path";

export async function GET() {
  try {
    // Try backend path first, then public/ fallback
    const backendPath = path.join(process.cwd(), "../backend/signals.json");
    const publicPath = path.join(process.cwd(), "public/signals.json");

    const filePath = existsSync(backendPath) ? backendPath : publicPath;
    const raw = readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "signals.json not found — run backend/scanner.py first" },
      { status: 404 }
    );
  }
}
