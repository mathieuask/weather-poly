import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import path from "path";

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), "../backend/signals.json");
    const raw = readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "signals.json not found — run backend/scanner.py first" },
      { status: 404 }
    );
  }
}
