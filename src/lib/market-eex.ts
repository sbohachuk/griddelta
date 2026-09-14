import {
  ZONES,
  dayShortCode,
  monthMaturity,
  isoWeekMaturity,
  type Zone,
  type ZoneId,
} from "./zones";
import type { CellQuote, DailyEuUa, DecadeSummary, MarketReport } from "./market-types";
import { enumerateDates, addDaysIso, isoToday } from "./utils";

const EEX_TABLE = "https://api.eex-group.com/pub/market-data/table-data";
const EC_AVG =
  "https://www.energy-charts.info/charts/price_average/data/all/day_month_euro_mwh_{year}_{month}.json";
const NBU_EUR =
  "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=EUR&date={ymd}&json";

const EEX_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json, text/javascript, */*; q=0.01",
  Referer: "https://www.eex.com/en/market-data/market-data-hub",
  Origin: "https://www.eex.com",
};

export type EexPoint = { tradeDate: string; settlPx: number };

function isoDateRe(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseInput(data: unknown): { startDate: string; endDate: string } {
  if (!data || typeof data !== "object") throw new Error("Некоректний запит");
  const rec = data as Record<string, unknown>;
  if (!isoDateRe(rec.startDate) || !isoDateRe(rec.endDate)) {
    throw new Error("Дати мають бути у форматі YYYY-MM-DD");
  }
  if (rec.startDate > rec.endDate) throw new Error("Початкова дата пізніша за кінцеву");
  const dates = enumerateDates(rec.startDate, rec.endDate);
  if (dates.length === 0) throw new Error("Порожній період");
  if (dates.length > 62) throw new Error("Максимум 62 дні за один запит");
  return { startDate: rec.startDate, endDate: rec.endDate };
}

export async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * In-request URL cache. Empty EEX tables are NOT cached — otherwise the first
 * rate-limited empty response poisons all later retries of the same URL.
 */
export const fetchCache = new Map<string, Promise<unknown>>();

function isEexTableUrl(url: string): boolean {
  return url.includes("api.eex-group.com");
}

function eexTableHasRows(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const data = (raw as { data?: unknown }).data;
  return Array.isArray(data) && data.length > 0;
}

function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const cacheKey = init?.method && init.method !== "GET" ? null : url;
  if (cacheKey && fetchCache.has(cacheKey)) return fetchCache.get(cacheKey)!;
  const p = fetchJsonUncached(url, init).then((raw) => {
    // Do not keep empty EEX responses in cache — allow retries to re-hit the API
    if (cacheKey && isEexTableUrl(url) && !eexTableHasRows(raw)) {
      fetchCache.delete(cacheKey);
    }
    return raw;
  });
  if (cacheKey) {
    fetchCache.set(cacheKey, p);
    p.catch(() => fetchCache.delete(cacheKey));
  }
  return p;
}

/** 3 attempts, long timeouts — EEX public API throttles parallel clients. */
async function fetchJsonUncached(url: string, init?: RequestInit): Promise<unknown> {
  let lastErr: unknown;
  const timeouts = [30_000, 45_000, 60_000];
  const backoffs = [800, 2_000, 3_500];
  for (let attempt = 0; attempt < timeouts.length; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeouts[attempt]);
    try {
      const res = await fetch(url, {
        ...init,
        signal: ctrl.signal,
        headers: { ...EEX_HEADERS, ...(init?.headers as Record<string, string> | undefined) },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (attempt < timeouts.length - 1) await sleep(backoffs[attempt]);
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function headerIndex(header: unknown, name: string): number {
  if (!Array.isArray(header)) return -1;
  return header.findIndex((h) => String(h) === name);
}

function parseEexTable(raw: unknown): EexPoint[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as { header?: unknown; data?: unknown };
  const rows = Array.isArray(obj.data) ? obj.data : [];
  const tradeIdx = headerIndex(obj.header, "tradeDate");
  const pxIdx = headerIndex(obj.header, "settlPx");
  const out: EexPoint[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const trade = tradeIdx >= 0 ? row[tradeIdx] : row[2];
    const px = pxIdx >= 0 ? row[pxIdx] : row[8];
    if (px === null || px === undefined) continue;
    const n = Number(px);
    if (!Number.isFinite(n)) continue;
    const date = String(trade ?? "").split("T")[0];
    if (!isoDateRe(date)) continue;
    out.push({ tradeDate: date, settlPx: Math.round(n * 100) / 100 });
  }
  out.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  return out;
}

export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  const n = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

export function lastPoint(points: EexPoint[]): EexPoint | null {
  return points.length ? points[points.length - 1] : null;
}

/**
 * Архів day-futures: останній settlement СТРОГО ДО дня поставки.
 * Не беремо settlement у день поставки (часто = spot).
 */
export function lastPointBefore(points: EexPoint[], deliveryDate: string): EexPoint | null {
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].tradeDate < deliveryDate) return points[i];
  }
  return null;
}

export function pointOnDate(points: EexPoint[], date: string): EexPoint | null {
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].tradeDate === date) return points[i];
  }
  return null;
}

/**
 * Day-контракт: тягнемо історію з 1-го числа,
 * але endDate = день ПЕРЕД поставкою (якщо поставка вже настала / сьогодні),
 * щоб не підтягнути фінальний settlement = spot.
 */
export async function fetchDayContract(zone: Zone, deliveryDate: string): Promise<EexPoint[]> {
  if (!zone.dayPrefix) return [];
  const shortCode = dayShortCode(zone.dayPrefix, deliveryDate);
  const maturity = monthMaturity(deliveryDate);
  // Ширше вікно історії — ранні дні місяця інакше часто порожні
  const monthStart = deliveryDate.slice(0, 8) + "01";
  const histStart = addDaysIso(monthStart, -28);
  const tryOnce = async (isRolling: string): Promise<EexPoint[]> => {
    const params = new URLSearchParams({
      shortCode,
      commodity: "POWER",
      pricing: "F",
      area: zone.eexArea,
      product: "Base",
      maturity,
      startDate: histStart,
      endDate: deliveryDate,
      maturityType: "Day",
      isRolling,
    });
    try {
      const raw = await fetchJson(`${EEX_TABLE}?${params.toString()}`);
      return parseEexTable(raw);
    } catch {
      return [];
    }
  };
  const a = await tryOnce("false");
  if (a.length) return a;
  await sleep(250);
  return tryOnce("true");
}

/** Calendar week codes: shortCode=DEB, maturity=202637 */
async function fetchCalendarMaturitySeries(
  shortCode: string,
  area: string,
  maturityType: "Week" | "Weekend",
  maturity: number,
  startDate: string,
  endDate: string,
): Promise<EexPoint[]> {
  const params = new URLSearchParams({
    shortCode,
    commodity: "POWER",
    pricing: "F",
    area,
    product: "Base",
    maturity: String(maturity),
    startDate,
    endDate,
    maturityType,
    isRolling: "false",
  });
  try {
    const raw = await fetchJson(`${EEX_TABLE}?${params.toString()}`);
    return parseEexTable(raw);
  } catch {
    return [];
  }
}

export async function fetchWeekContract(
  zone: Zone,
  startDate: string,
  endDate: string,
): Promise<EexPoint[]> {
  if (!zone.weekCode) return [];
  const mats = [
    ...new Set(enumerateDates(startDate, endDate).map((d) => isoWeekMaturity(d))),
  ];
  const chunks = await Promise.all(
    mats.map((m) =>
      fetchCalendarMaturitySeries(zone.weekCode!, zone.eexArea, "Week", m, startDate, endDate),
    ),
  );
  const byDate = new Map<string, EexPoint>();
  for (const pts of chunks) {
    for (const p of pts) byDate.set(p.tradeDate, p);
  }
  return [...byDate.values()].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
}

export async function fetchWeekendContract(
  zone: Zone,
  startDate: string,
  endDate: string,
): Promise<EexPoint[]> {
  if (!zone.weekendCode) return [];
  const mats = [
    ...new Set(enumerateDates(startDate, endDate).map((d) => isoWeekMaturity(d))),
  ];
  const chunks = await Promise.all(
    mats.map((m) =>
      fetchCalendarMaturitySeries(
        zone.weekendCode!,
        zone.eexArea,
        "Weekend",
        m,
        startDate,
        endDate,
      ),
    ),
  );
  const byDate = new Map<string, EexPoint>();
  for (const pts of chunks) {
    for (const p of pts) byDate.set(p.tradeDate, p);
  }
  return [...byDate.values()].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
}

export async function fetchMonthContract(
  zone: Zone,
  startDate: string,
  endDate: string,
): Promise<EexPoint[]> {
  const mats = [
    ...new Set(enumerateDates(startDate, endDate).map((d) => monthMaturity(d))),
  ];
  // Довга історія — month quotes з’являються заздалегідь; API їх віддає
  const histStart = addDaysIso(startDate, -120);
  const histEnd = endDate;
  const chunks: EexPoint[][] = [];
  for (const maturity of mats) {
    const tryMode = async (isRolling: string) => {
      const params = new URLSearchParams({
        shortCode: zone.monthCode,
        commodity: "POWER",
        pricing: "F",
        area: zone.eexArea,
        product: "Base",
        maturity,
        startDate: histStart,
        endDate: histEnd,
        maturityType: "Month",
        isRolling,
      });
      try {
        const raw = await fetchJson(`${EEX_TABLE}?${params.toString()}`);
        return parseEexTable(raw);
      } catch {
        return [] as EexPoint[];
      }
    };
    // Послідовно: calendar → rolling → пауза → повтор (не паралельно — rate-limit)
    let pts = await tryMode("false");
    if (!pts.length) {
      await sleep(400);
      pts = await tryMode("true");
    }
    if (!pts.length) {
      await sleep(1_500);
      pts = await tryMode("false");
      if (!pts.length) {
        await sleep(400);
        pts = await tryMode("true");
      }
    }
    if (pts.length) chunks.push(pts);
  }
  const byDate = new Map<string, EexPoint>();
  for (const pts of chunks) {
    for (const p of pts) byDate.set(p.tradeDate, p);
  }
  return [...byDate.values()].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
}

type SpotMap = Record<string, Partial<Record<ZoneId | "UA", number>>>;
type UaUahMap = Record<string, number>;

function seriesName(series: unknown): string {
  if (!series || typeof series !== "object") return "";
  const name = (series as { name?: unknown }).name;
  if (Array.isArray(name) && name[0] && typeof name[0] === "object") {
    return String((name[0] as { en?: string }).en ?? "");
  }
  if (name && typeof name === "object") return String((name as { en?: string }).en ?? "");
  return "";
}

function parseSpotMonth(raw: unknown, into: SpotMap, uaUah: UaUahMap) {
  if (!Array.isArray(raw) || raw.length === 0) return;
  const xAxis = (raw[0] as { xAxisValues?: unknown }).xAxisValues;
  const dates = Array.isArray(xAxis) ? xAxis.map((d) => String(d)) : [];
  for (const series of raw) {
    const en = seriesName(series);
    const data = (series as { data?: unknown }).data;
    if (!Array.isArray(data)) continue;

    if (en.includes("UA-IPS") || (en.includes("UA") && en.includes("Day Ahead"))) {
      for (let i = 0; i < dates.length; i++) {
        const price = data[i];
        if (price === null || price === undefined) continue;
        const n = Number(price);
        if (!Number.isFinite(n)) continue;
        const rawDate = dates[i];
        let iso = rawDate;
        const m = rawDate.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
        if (m) iso = `${m[3]}-${m[2]}-${m[1]}`;
        uaUah[iso] = Math.round(n * 100) / 100;
      }
      continue;
    }

    const zone = ZONES.find((z) => en.includes(z.spotNeedle) && en.includes("Day Ahead"));
    if (!zone) continue;
    for (let i = 0; i < dates.length; i++) {
      const price = data[i];
      if (price === null || price === undefined) continue;
      const n = Number(price);
      if (!Number.isFinite(n)) continue;
      const rawDate = dates[i];
      let iso = rawDate;
      const m = rawDate.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      if (m) iso = `${m[3]}-${m[2]}-${m[1]}`;
      if (!into[iso]) into[iso] = {};
      into[iso][zone.id] = Math.round(n * 100) / 100;
    }
  }
}

export async function fetchSpot(
  startDate: string,
  endDate: string,
): Promise<{ spot: SpotMap; uaUah: UaUahMap }> {
  const months = new Set<string>();
  for (const d of enumerateDates(startDate, endDate)) {
    months.add(d.slice(0, 7));
  }
  const into: SpotMap = {};
  const uaUah: UaUahMap = {};
  await Promise.all(
    [...months].map(async (ym) => {
      const [year, month] = ym.split("-");
      const url = EC_AVG.replace("{year}", year).replace("{month}", month);
      try {
        const raw = await fetchJson(url, {
          headers: { Accept: "application/json", "User-Agent": EEX_HEADERS["User-Agent"] },
        });
        parseSpotMonth(raw, into, uaUah);
      } catch {
        /* month may 404 for the future */
      }
    }),
  );
  return { spot: into, uaUah };
}

export async function fetchEurUah(isoDate: string): Promise<number> {
  const ymd = isoDate.replace(/-/g, "");
  try {
    const raw = await fetchJson(NBU_EUR.replace("{ymd}", ymd), {
      headers: { Accept: "application/json", "User-Agent": EEX_HEADERS["User-Agent"] },
    });
    if (Array.isArray(raw) && raw[0] && typeof (raw[0] as { rate?: number }).rate === "number") {
      return Math.round((raw[0] as { rate: number }).rate * 10000) / 10000;
    }
  } catch {
    /* ignore */
  }
  return 46.5;
}

export function delta(futures: number | null, spot: number | null): { eur: number | null; pct: number | null } {
  if (futures === null || spot === null) return { eur: null, pct: null };
  const eur = Math.round((futures - spot) * 100) / 100;
  const pct = spot === 0 ? null : Math.round((eur / spot) * 10000) / 100;
  return { eur, pct };
}

export function mean(nums: number[]): number | null {
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
}

export function decadeBounds(isoDate: string): { start: string; end: string; label: string } {
  const y = isoDate.slice(0, 4);
  const m = isoDate.slice(5, 7);
  const d = Number(isoDate.slice(8, 10));
  const lastDay = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
  if (d <= 10) {
    return { start: `${y}-${m}-01`, end: `${y}-${m}-10`, label: `1–10 ${m}.${y}` };
  }
  if (d <= 20) {
    return { start: `${y}-${m}-11`, end: `${y}-${m}-20`, label: `11–20 ${m}.${y}` };
  }
  const endDay = String(lastDay).padStart(2, "0");
  return { start: `${y}-${m}-21`, end: `${y}-${m}-${endDay}`, label: `21–${endDay} ${m}.${y}` };
}

