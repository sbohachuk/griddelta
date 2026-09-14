import { getSql } from "./db";
import type { CellQuote, DailyEuUa } from "./market-types";
import type { ZoneId } from "./zones";
import { ZONES } from "./zones";

let schemaReady: Promise<void> | null = null;

/** Ensure cache tables exist (PGLite migrations + Neon without manual migrate). */
async function ensureMarketSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = await getSql();
      await sql.query(`
        CREATE TABLE IF NOT EXISTS market_zone_quotes (
          trade_date date NOT NULL,
          zone_id text NOT NULL,
          spot double precision,
          day_futures double precision,
          week_futures double precision,
          weekend_futures double precision,
          month_futures double precision,
          day_trade_date date,
          week_trade_date date,
          weekend_trade_date date,
          month_trade_date date,
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (trade_date, zone_id)
        )`);
      await sql.query(`
        CREATE TABLE IF NOT EXISTS market_eu_ua (
          trade_date date NOT NULL PRIMARY KEY,
          eu_avg double precision,
          ua_rdn_eur double precision,
          ua_rdn_uah double precision,
          delta_pct double precision,
          eur_uah double precision,
          updated_at timestamptz NOT NULL DEFAULT now()
        )`);
    })().catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  await schemaReady;
}

export type CachedZoneRow = {
  trade_date: string;
  zone_id: string;
  spot: number | null;
  day_futures: number | null;
  week_futures: number | null;
  weekend_futures: number | null;
  month_futures: number | null;
  day_trade_date: string | null;
  week_trade_date: string | null;
  weekend_trade_date: string | null;
  month_trade_date: string | null;
};

export type CachedEuUaRow = {
  trade_date: string;
  eu_avg: number | null;
  ua_rdn_eur: number | null;
  ua_rdn_uah: number | null;
  delta_pct: number | null;
  eur_uah: number | null;
};

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function dateStr(v: unknown): string {
  if (typeof v === "string") return v.slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v ?? "").slice(0, 10);
}

/** Load cached zone quotes for [start, end]. Missing dates simply absent. */
export async function loadCachedZoneQuotes(
  startDate: string,
  endDate: string,
): Promise<Map<string, Map<ZoneId, CellQuote>>> {
  const out = new Map<string, Map<ZoneId, CellQuote>>();
  try {
    await ensureMarketSchema();
    const sql = await getSql();
    const rows = await sql<CachedZoneRow>`
      select trade_date, zone_id, spot, day_futures, week_futures, weekend_futures, month_futures,
             day_trade_date, week_trade_date, weekend_trade_date, month_trade_date
      from market_zone_quotes
      where trade_date >= ${startDate} and trade_date <= ${endDate}
    `;
    for (const r of rows) {
      const d = dateStr(r.trade_date);
      const z = r.zone_id as ZoneId;
      if (!out.has(d)) out.set(d, new Map());
      const spot = num(r.spot);
      const dayFutures = num(r.day_futures);
      const weekFutures = num(r.week_futures);
      const weekendFutures = num(r.weekend_futures);
      const monthFutures = num(r.month_futures);
      out.get(d)!.set(z, {
        spot,
        dayFutures,
        weekFutures,
        weekendFutures,
        monthFutures,
        dayDeltaEur: null,
        dayDeltaPct: null,
        weekDeltaEur: null,
        weekDeltaPct: null,
        weekendDeltaEur: null,
        weekendDeltaPct: null,
        monthDeltaEur: null,
        monthDeltaPct: null,
        dayTradeDate: r.day_trade_date ? dateStr(r.day_trade_date) : null,
        weekTradeDate: r.week_trade_date ? dateStr(r.week_trade_date) : null,
        weekendTradeDate: r.weekend_trade_date ? dateStr(r.weekend_trade_date) : null,
        monthTradeDate: r.month_trade_date ? dateStr(r.month_trade_date) : null,
      });
    }
  } catch {
    // Table may not exist yet — fail soft
  }
  return out;
}

export async function loadCachedEuUa(
  startDate: string,
  endDate: string,
): Promise<Map<string, DailyEuUa>> {
  const out = new Map<string, DailyEuUa>();
  try {
    await ensureMarketSchema();
    const sql = await getSql();
    const rows = await sql<CachedEuUaRow>`
      select trade_date, eu_avg, ua_rdn_eur, ua_rdn_uah, delta_pct, eur_uah
      from market_eu_ua
      where trade_date >= ${startDate} and trade_date <= ${endDate}
    `;
    for (const r of rows) {
      const d = dateStr(r.trade_date);
      out.set(d, {
        date: d,
        euAvg: num(r.eu_avg),
        uaRdnEur: num(r.ua_rdn_eur),
        uaRdnUah: num(r.ua_rdn_uah),
        deltaPct: num(r.delta_pct),
        eurUah: num(r.eur_uah),
      });
    }
  } catch {
    /* soft */
  }
  return out;
}

/**
 * Past day is "solid" if every zone has a cached row with at least spot
 * (day-ahead fact). Futures may still be filled later via gap-pass.
 */
export function isPastDateSolid(
  date: string,
  today: string,
  zoneCache: Map<string, Map<ZoneId, CellQuote>>,
): boolean {
  if (date >= today) return false;
  const byZone = zoneCache.get(date);
  if (!byZone || byZone.size < ZONES.length) return false;
  for (const z of ZONES) {
    const cell = byZone.get(z.id);
    if (!cell || cell.spot === null) return false;
  }
  return true;
}

/** Dates that must hit live APIs: not solid past, or today/future. */
export function datesNeedingFetch(
  dates: string[],
  today: string,
  zoneCache: Map<string, Map<ZoneId, CellQuote>>,
): string[] {
  return dates.filter((d) => !isPastDateSolid(d, today, zoneCache));
}

export async function upsertZoneQuotes(
  rows: { date: string; zoneId: ZoneId; cell: CellQuote }[],
): Promise<void> {
  if (!rows.length) return;
  try {
    await ensureMarketSchema();
    const sql = await getSql();
    for (const r of rows) {
      const c = r.cell;
      await sql`
        insert into market_zone_quotes (
          trade_date, zone_id, spot, day_futures, week_futures, weekend_futures, month_futures,
          day_trade_date, week_trade_date, weekend_trade_date, month_trade_date, updated_at
        ) values (
          ${r.date}, ${r.zoneId},
          ${c.spot}, ${c.dayFutures}, ${c.weekFutures}, ${c.weekendFutures}, ${c.monthFutures},
          ${c.dayTradeDate}, ${c.weekTradeDate}, ${c.weekendTradeDate}, ${c.monthTradeDate},
          now()
        )
        on conflict (trade_date, zone_id) do update set
          spot = coalesce(excluded.spot, market_zone_quotes.spot),
          day_futures = coalesce(excluded.day_futures, market_zone_quotes.day_futures),
          week_futures = coalesce(excluded.week_futures, market_zone_quotes.week_futures),
          weekend_futures = coalesce(excluded.weekend_futures, market_zone_quotes.weekend_futures),
          month_futures = coalesce(excluded.month_futures, market_zone_quotes.month_futures),
          day_trade_date = coalesce(excluded.day_trade_date, market_zone_quotes.day_trade_date),
          week_trade_date = coalesce(excluded.week_trade_date, market_zone_quotes.week_trade_date),
          weekend_trade_date = coalesce(excluded.weekend_trade_date, market_zone_quotes.weekend_trade_date),
          month_trade_date = coalesce(excluded.month_trade_date, market_zone_quotes.month_trade_date),
          updated_at = now()
      `;
    }
  } catch {
    /* soft — cache is best-effort */
  }
}

export async function upsertEuUa(rows: DailyEuUa[]): Promise<void> {
  if (!rows.length) return;
  try {
    await ensureMarketSchema();
    const sql = await getSql();
    for (const r of rows) {
      await sql`
        insert into market_eu_ua (trade_date, eu_avg, ua_rdn_eur, ua_rdn_uah, delta_pct, eur_uah, updated_at)
        values (${r.date}, ${r.euAvg}, ${r.uaRdnEur}, ${r.uaRdnUah}, ${r.deltaPct}, ${r.eurUah}, now())
        on conflict (trade_date) do update set
          eu_avg = coalesce(excluded.eu_avg, market_eu_ua.eu_avg),
          ua_rdn_eur = coalesce(excluded.ua_rdn_eur, market_eu_ua.ua_rdn_eur),
          ua_rdn_uah = coalesce(excluded.ua_rdn_uah, market_eu_ua.ua_rdn_uah),
          delta_pct = coalesce(excluded.delta_pct, market_eu_ua.delta_pct),
          eur_uah = coalesce(excluded.eur_uah, market_eu_ua.eur_uah),
          updated_at = now()
      `;
    }
  } catch {
    /* soft */
  }
}

/** Recompute delta fields from spot vs futures. */
export function fillDeltas(cell: CellQuote): CellQuote {
  const d = (f: number | null, s: number | null) => {
    if (f === null || s === null) return { eur: null as number | null, pct: null as number | null };
    const eur = Math.round((f - s) * 100) / 100;
    const pct = s === 0 ? null : Math.round((eur / s) * 10000) / 100;
    return { eur, pct };
  };
  const day = d(cell.dayFutures, cell.spot);
  const week = d(cell.weekFutures, cell.spot);
  const we = d(cell.weekendFutures, cell.spot);
  const month = d(cell.monthFutures, cell.spot);
  return {
    ...cell,
    dayDeltaEur: day.eur,
    dayDeltaPct: day.pct,
    weekDeltaEur: week.eur,
    weekDeltaPct: week.pct,
    weekendDeltaEur: we.eur,
    weekendDeltaPct: we.pct,
    monthDeltaEur: month.eur,
    monthDeltaPct: month.pct,
  };
}
