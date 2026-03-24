import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WU_KEY = "e1f10a1e78da46f5b10a1e78da96f525";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

const STATIONS: Record<string, { country: string; city: string }> = {
  EGLC: { country: "GB", city: "London" },
  KLGA: { country: "US", city: "NYC" },
  RKSI: { country: "KR", city: "Seoul" },
};

const CITY_SLUGS: Record<string, string> = {
  london: "EGLC",
  "new york": "KLGA",
  nyc: "KLGA",
  seoul: "RKSI",
};

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

const sb = createClient(SB_URL, SB_KEY);

// ── CLOB fetch ─────────────────────────────────────────────

async function clob(token: string, startTs: number, endTs: number): Promise<{ t: number; p: number }[]> {
  try {
    const url = `https://clob.polymarket.com/prices-history?market=${token}&startTs=${startTs}&endTs=${endTs}&fidelity=5`;
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (!r.ok) return [];
    const data = await r.json();
    return data.history || [];
  } catch {
    return [];
  }
}

// ── 1. Fetch open prices ───────────────────────────────────

async function fetchOpenPrices() {
  const { data: brackets } = await sb
    .from("poly_markets")
    .select("condition_id,station,date,clob_token_yes")
    .eq("resolved", false)
    .not("clob_token_yes", "is", null)
    .order("station")
    .order("date");

  if (!brackets || brackets.length === 0) {
    log("prices: no open brackets");
    return;
  }

  log(`prices: ${brackets.length} open brackets`);
  const now = Math.floor(Date.now() / 1000);
  let totalNew = 0;

  for (const b of brackets) {
    // Last ts in DB
    const { data: lastRow } = await sb
      .from("price_history")
      .select("ts")
      .eq("condition_id", b.condition_id)
      .order("ts", { ascending: false })
      .limit(1);

    const lastTs = lastRow?.[0]?.ts ?? Math.floor(new Date(b.date).getTime() / 1000) - 5 * 86400;

    const history = await clob(b.clob_token_yes, lastTs, now);
    const newPts = history
      .filter((p) => p.t > lastTs)
      .map((p) => ({
        condition_id: b.condition_id,
        station: b.station,
        target_date: b.date,
        ts: p.t,
        price_yes: Math.round(p.p * 10000) / 10000,
      }));

    if (newPts.length > 0) {
      // Insert in chunks of 200
      for (let i = 0; i < newPts.length; i += 200) {
        await sb.from("price_history").upsert(newPts.slice(i, i + 200), { onConflict: "condition_id,ts", ignoreDuplicates: true });
      }
      totalNew += newPts.length;
    }

    // Small delay to avoid rate limits
    await new Promise((r) => setTimeout(r, 100));
  }

  log(`prices: +${totalNew} points`);
}

// ── 2. Check resolutions ───────────────────────────────────

async function checkResolutions() {
  const { data: openEvents } = await sb
    .from("poly_events")
    .select("event_id,station,target_date,city")
    .eq("closed", false)
    .order("target_date");

  if (!openEvents || openEvents.length === 0) {
    log("resolutions: no open events");
    return;
  }

  log(`resolutions: ${openEvents.length} open events`);

  for (const ev of openEvents) {
    try {
      const r = await fetch(`https://gamma-api.polymarket.com/events/${ev.event_id}`, {
        headers: { "User-Agent": UA },
      });
      if (!r.ok) continue;
      const gamma = await r.json();
      const markets = gamma.markets || [];

      // Only check resolved (not just closed)
      const anyResolved = markets.some((m: any) => m.resolved);
      if (!anyResolved) continue;

      log(`resolutions: ${ev.city} ${ev.target_date} RESOLVED`);

      // Update event
      await sb.from("poly_events").update({ closed: true }).eq("event_id", ev.event_id);

      // Update winners
      for (const m of markets) {
        if (!m.conditionId || !m.resolved) continue;
        const prices = JSON.parse(m.outcomePrices || "[]");
        let winner: string | null = null;
        try {
          if (prices.length && parseFloat(prices[0]) > 0.9) winner = "YES";
          else if (prices.length > 1 && parseFloat(prices[1]) > 0.9) winner = "NO";
        } catch { /* ignore */ }

        await sb
          .from("poly_markets")
          .update({ winner, resolved: true })
          .eq("condition_id", m.conditionId);
      }

      // Fetch WU temperature
      const info = STATIONS[ev.station];
      if (info) {
        const wuDate = ev.target_date.replace(/-/g, "");
        try {
          const wuR = await fetch(
            `https://api.weather.com/v1/location/${ev.station}:9:${info.country}/observations/historical.json?apiKey=${WU_KEY}&units=m&startDate=${wuDate}`
          );
          if (wuR.ok) {
            const obs = (await wuR.json()).observations || [];
            const temps = obs.filter((o: any) => o.temp != null).map((o: any) => o.temp as number);
            if (temps.length > 0) {
              await sb.from("daily_temps").upsert([{
                station: ev.station,
                date: ev.target_date,
                temp_max_c: Math.round(Math.max(...temps) * 10) / 10,
                source: "wunderground",
                is_polymarket_day: true,
              }], { onConflict: "station,date", ignoreDuplicates: true });
              log(`  WU: ${Math.max(...temps)}°C`);
            }
          }
        } catch { log("  WU: fetch error"); }
      }

      // Complete price curves post-resolution
      const { data: eventBrackets } = await sb
        .from("poly_markets")
        .select("condition_id,station,clob_token_yes")
        .eq("poly_event_id", ev.event_id)
        .not("clob_token_yes", "is", null);

      if (eventBrackets) {
        const endTs = Math.floor(new Date(ev.target_date).getTime() / 1000) + 2 * 86400;
        for (const b of eventBrackets) {
          const { data: lr } = await sb
            .from("price_history")
            .select("ts")
            .eq("condition_id", b.condition_id)
            .order("ts", { ascending: false })
            .limit(1);
          const lt = lr?.[0]?.ts ?? 0;
          const history = await clob(b.clob_token_yes, lt, endTs);
          const pts = history
            .filter((p) => p.t > lt)
            .map((p) => ({
              condition_id: b.condition_id,
              station: b.station,
              target_date: ev.target_date,
              ts: p.t,
              price_yes: Math.round(p.p * 10000) / 10000,
            }));
          if (pts.length > 0) {
            for (let i = 0; i < pts.length; i += 200) {
              await sb.from("price_history").upsert(pts.slice(i, i + 200), { onConflict: "condition_id,ts", ignoreDuplicates: true });
            }
          }
          await new Promise((r) => setTimeout(r, 100));
        }
      }

      await new Promise((r) => setTimeout(r, 500));
    } catch (e) {
      log(`resolutions error: ${e}`);
    }
  }
}

// ── 3. Check new events ────────────────────────────────────

async function checkNewEvents() {
  try {
    const r = await fetch("https://gamma-api.polymarket.com/events?tag_slug=temperature&limit=100&closed=false", {
      headers: { "User-Agent": UA },
    });
    if (!r.ok) return;
    const gammaEvents = await r.json();

    log(`events: ${gammaEvents.length} open on Gamma`);

    for (const event of gammaEvents) {
      const title = (event.title || "").toLowerCase();

      let station: string | null = null;
      let cityName: string | null = null;
      for (const [slug, stn] of Object.entries(CITY_SLUGS)) {
        if (title.includes(slug)) {
          station = stn;
          cityName = STATIONS[stn].city;
          break;
        }
      }
      if (!station || !cityName) continue;

      const eventId = String(event.id);

      // Already in DB?
      const { data: existing } = await sb
        .from("poly_events")
        .select("event_id")
        .eq("event_id", eventId)
        .limit(1);
      if (existing && existing.length > 0) continue;

      // Parse date from title
      const dateMatch = (event.title || "").match(/on\s+(\w+)\s+(\d+)(?:,?\s*(\d{4}))?/);
      if (!dateMatch) continue;
      const month = MONTHS[dateMatch[1].toLowerCase()];
      if (!month) continue;
      const day = parseInt(dateMatch[2]);
      const year = dateMatch[3] ? parseInt(dateMatch[3]) : new Date().getFullYear();
      const targetDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

      const markets = event.markets || [];

      // Insert event
      await sb.from("poly_events").upsert([{
        event_id: eventId,
        slug: event.slug,
        title: event.title,
        city: cityName,
        station,
        target_date: targetDate,
        created_at: event.creationDate || event.startDate,
        closed: false,
        unit: "C",
        n_brackets: markets.length,
        total_volume: markets.reduce((s: number, m: any) => s + parseFloat(m.volume || "0"), 0),
      }], { onConflict: "event_id", ignoreDuplicates: true });

      // Insert brackets
      for (const m of markets) {
        const question = m.question || m.groupItemTitle || "";
        const clobIds = JSON.parse(m.clobTokenIds || "[]");
        const q = question.toLowerCase();

        let bracketTemp: number | null = null;
        let bracketOp = "exact";

        if (/or\s+below/.test(q)) {
          const tm = q.match(/(-?\d+)\s*°/);
          if (tm) { bracketTemp = parseInt(tm[1]); bracketOp = "lte"; }
        } else if (/or\s+(?:higher|above)/.test(q)) {
          const tm = q.match(/(-?\d+)\s*°/);
          if (tm) { bracketTemp = parseInt(tm[1]); bracketOp = "gte"; }
        } else {
          const tm = q.match(/be\s+(-?\d+)\s*°/);
          if (tm) { bracketTemp = parseInt(tm[1]); bracketOp = "exact"; }
        }

        await sb.from("poly_markets").upsert([{
          station,
          date: targetDate,
          condition_id: m.conditionId,
          bracket_str: question,
          bracket_temp: bracketTemp,
          bracket_op: bracketOp,
          unit: "C",
          winner: null,
          resolved: false,
          volume: parseFloat(m.volume || "0"),
          clob_token_yes: clobIds[0] || null,
          clob_token_no: clobIds[1] || null,
          poly_event_id: eventId,
          event_title: event.title,
        }], { onConflict: "condition_id", ignoreDuplicates: true });
      }

      log(`events: +1 ${cityName} ${targetDate} (${markets.length} brackets)`);
    }
  } catch (e) {
    log(`events error: ${e}`);
  }
}

// ── Handler ────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    // 1. Always: fetch prices
    await fetchOpenPrices();

    // 2. Always: check resolutions
    await checkResolutions();

    // 3. Once per day at ~10h UTC: check new events
    const hour = new Date().getUTCHours();
    if (hour === 10) {
      await checkNewEvents();
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    log(`ERROR: ${e}`);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
