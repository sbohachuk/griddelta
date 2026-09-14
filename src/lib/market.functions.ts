import { createServerFn } from "@tanstack/react-start";
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

type EexPoint = { tradeDate: string; settlPx: number };

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

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/** In-request cache: identical URLs share one in-flight promise (big win on overlaps). */
const fetchCache = new Map<string, Promise<unknown>>();

function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const cacheKey = init?.method && init.method !== "GET" ? null : url;
  if (cacheKey && fetchCache.has(cacheKey)) return fetchCache.get(cacheKey)!;
  const p = fetchJsonUncached(url, init);
  if (cacheKey) {
    fetchCache.set(cacheKey, p);
    p.catch(() => fetchCache.delete(cacheKey));
  }
  return p;
}

/** 2 attempts, short backoff; first timeout 12s, second 22s. */
async function fetchJsonUncached(url: string, init?: RequestInit): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const ms = attempt === 0 ? 12_000 : 22_000;
    const t = setTimeout(() => ctrl.abort(), ms);
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
      if (attempt === 0) await sleep(200);
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

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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

function lastPoint(points: EexPoint[]): EexPoint | null {
  return points.length ? points[points.length - 1] : null;
}

/**
 * Архів day-futures: останній settlement СТРОГО ДО дня поставки.
 * Не беремо settlement у день поставки (часто = spot).
 */
function lastPointBefore(points: EexPoint[], deliveryDate: string): EexPoint | null {
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].tradeDate < deliveryDate) return points[i];
  }
  return null;
}

function pointOnDate(points: EexPoint[], date: string): EexPoint | null {
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
async function fetchDayContract(zone: Zone, deliveryDate: string): Promise<EexPoint[]> {
  if (!zone.dayPrefix) return [];
  const shortCode = dayShortCode(zone.dayPrefix, deliveryDate);
  const maturity = monthMaturity(deliveryDate);
  // Ширше вікно історії, щоб ранні дні місяця не губилися
  const monthStart = deliveryDate.slice(0, 8) + "01";
  const histStart = addDaysIso(monthStart, -14);
  // Тягнемо повну історію до deliveryDate; архів береться через lastPointBefore (без дня поставки)
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
    isRolling: "false",
  });
  try {
    const raw = await fetchJson(`${EEX_TABLE}?${params.toString()}`);
    return parseEexTable(raw);
  } catch {
    return [];
  }
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

async function fetchWeekContract(
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

async function fetchWeekendContract(
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

async function fetchMonthContract(
  zone: Zone,
  startDate: string,
  endDate: string,
): Promise<EexPoint[]> {
  const mats = [
    ...new Set(enumerateDates(startDate, endDate).map((d) => monthMaturity(d))),
  ];
  // Ширша історія settlement — інакше public API часто повертає порожньо
  const histStart = addDaysIso(startDate, -45);
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
    // Обидва режими паралельно — беремо перший непорожній
    const [a, b] = await Promise.all([tryMode("false"), tryMode("true")]);
    if (a.length) chunks.push(a);
    else if (b.length) chunks.push(b);
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

async function fetchSpot(
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

async function fetchEurUah(isoDate: string): Promise<number> {
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

function delta(futures: number | null, spot: number | null): { eur: number | null; pct: number | null } {
  if (futures === null || spot === null) return { eur: null, pct: null };
  const eur = Math.round((futures - spot) * 100) / 100;
  const pct = spot === 0 ? null : Math.round((eur / spot) * 10000) / 100;
  return { eur, pct };
}

function mean(nums: number[]): number | null {
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
}

function decadeBounds(isoDate: string): { start: string; end: string; label: string } {
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

export const loadMarket = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(data))
  .handler(async ({ data }): Promise<MarketReport> => {
    const { startDate, endDate } = data;
    const dates = enumerateDates(startDate, endDate);
    const warnings: string[] = [];

    // Швидкий пайплайн:
    // 1) Spot + Day паралельно (незалежні)
    // 2) Month + Week + Weekend + FX паралельно
    // Кеш URL усередині запиту; concurrency 8 на day.
    fetchCache.clear();
    const today = isoToday();
    const dayJobs: { zone: Zone; date: string }[] = [];
    for (const zone of ZONES) {
      if (!zone.dayPrefix) continue;
      for (const date of dates) dayJobs.push({ zone, date });
    }

    const dayPromise = mapPool(dayJobs, 8, async (job) => ({
      key: `${job.zone.id}:${job.date}`,
      points: await fetchDayContract(job.zone, job.date),
    }));
    const spotPromise = fetchSpot(startDate, endDate);

    const [{ spot, uaUah }, daySeries0] = await Promise.all([spotPromise, dayPromise]);
    let daySeries = daySeries0;

    // Retry лише минулі/сьогоднішні порожні (майбутні часто ще без котирувань)
    const missingDay = daySeries.filter((s) => {
      if (s.points.length > 0) return false;
      const date = s.key.split(":")[1]!;
      return date <= today;
    });
    if (missingDay.length > 0 && missingDay.length <= dayJobs.length * 0.7) {
      await sleep(150);
      const retried = await mapPool(missingDay, 6, async (s) => {
        const [zoneId, date] = s.key.split(":");
        const zone = ZONES.find((z) => z.id === zoneId)!;
        return { key: s.key, points: await fetchDayContract(zone, date) };
      });
      const byKey = new Map(daySeries.map((s) => [s.key, s]));
      for (const r of retried) byKey.set(r.key, r);
      daySeries = [...byKey.values()];
    }

    const fxDate = endDate <= today ? endDate : startDate;
    const [monthSeries, weekSeries, weekendSeries, eurUah] = await Promise.all([
      mapPool(ZONES, 6, (z) => fetchMonthContract(z, startDate, endDate)),
      mapPool(ZONES, 6, (z) => fetchWeekContract(z, startDate, endDate)),
      mapPool(ZONES, 6, (z) => fetchWeekendContract(z, startDate, endDate)),
      fetchEurUah(fxDate),
    ]);

    const emptyDays = daySeries.filter((s) => s.points.length === 0).length;
    if (emptyDays > 0) {
      warnings.push(
        `Day: ${emptyDays}/${dayJobs.length} без settlement (forward-fill заповнить прогалини).`,
      );
    }

    const monthByZone: Record<ZoneId, EexPoint[]> = {} as Record<ZoneId, EexPoint[]>;
    const weekByZone: Record<ZoneId, EexPoint[]> = {} as Record<ZoneId, EexPoint[]>;
    const weekendByZone: Record<ZoneId, EexPoint[]> = {} as Record<ZoneId, EexPoint[]>;
    ZONES.forEach((z, i) => {
      monthByZone[z.id] = monthSeries[i];
      weekByZone[z.id] = weekSeries[i];
      weekendByZone[z.id] = weekendSeries[i];
      if (monthSeries[i].length === 0) {
        warnings.push(
          `Month ${z.id} (${z.monthCode}): немає settlement у public API — у таблиці буде «—» (спробуйте вужчий період або пізніше).`,
        );
      }
    });

    const dayByKey = new Map(daySeries.map((s) => [s.key, s.points]));

    const rows: MarketReport["rows"] = {};
    for (const date of dates) {
      rows[date] = {} as Record<ZoneId, CellQuote>;
      for (const zone of ZONES) {
        const spotPx = spot[date]?.[zone.id] ?? null;
        const dayPts = zone.dayPrefix ? (dayByKey.get(`${zone.id}:${date}`) ?? []) : [];
        // Архів: settlement ДО поставки; для майбутніх днів — останній доступний quote
        const today = isoToday();
        const dayPt =
          date <= today
            ? lastPointBefore(dayPts, date)
            : lastPoint(dayPts) ?? lastPointBefore(dayPts, date);
        const weekPt =
          pointOnDate(weekByZone[zone.id] ?? [], date) ??
          lastPoint(weekByZone[zone.id] ?? []);
        const weekendPt =
          pointOnDate(weekendByZone[zone.id] ?? [], date) ??
          lastPoint(weekendByZone[zone.id] ?? []);
        // Month: settlement на дату або останній відомий до/на дату
        const monthPts = monthByZone[zone.id] ?? [];
        const monthPt =
          pointOnDate(monthPts, date) ??
          lastPointBefore(monthPts, addDaysIso(date, 1)) ??
          lastPoint(monthPts);

        const dayPx = dayPt?.settlPx ?? null;
        const weekPx = weekPt?.settlPx ?? null;
        const weekendPx = weekendPt?.settlPx ?? null;
        const monthPx = monthPt?.settlPx ?? null;

        const dDay = delta(dayPx, spotPx);
        const dWeek = delta(weekPx, spotPx);
        const dWeekend = delta(weekendPx, spotPx);
        const dMonth = delta(monthPx, spotPx);

        rows[date][zone.id] = {
          spot: spotPx,
          dayFutures: dayPx,
          weekFutures: weekPx,
          weekendFutures: weekendPx,
          monthFutures: monthPx,
          dayDeltaEur: dDay.eur,
          dayDeltaPct: dDay.pct,
          weekDeltaEur: dWeek.eur,
          weekDeltaPct: dWeek.pct,
          weekendDeltaEur: dWeekend.eur,
          weekendDeltaPct: dWeekend.pct,
          monthDeltaEur: dMonth.eur,
          monthDeltaPct: dMonth.pct,
          dayTradeDate: dayPt?.tradeDate ?? null,
          weekTradeDate: weekPt?.tradeDate ?? null,
          weekendTradeDate: weekendPt?.tradeDate ?? null,
          monthTradeDate: monthPt?.tradeDate ?? null,
        };
      }
    }



    // —— Forward-fill Day-архіву: якщо для дня немає цифри — беремо попередню по зоні (без пропусків) ——
    for (const zone of ZONES) {
      if (!zone.dayPrefix) continue;
      let last: number | null = null;
      let lastTd: string | null = null;
      for (const date of dates) {
        const cell = rows[date]?.[zone.id];
        if (!cell) continue;
        if (cell.dayFutures !== null) {
          last = cell.dayFutures;
          lastTd = cell.dayTradeDate;
        } else if (last !== null) {
          cell.dayFutures = last;
          cell.dayTradeDate = lastTd;
          const dDay = delta(last, cell.spot);
          cell.dayDeltaEur = dDay.eur;
          cell.dayDeltaPct = dDay.pct;
        }
      }
    }

    // —— Forward-fill Month по зоні ——
    for (const zone of ZONES) {
      let last: number | null = null;
      let lastTd: string | null = null;
      for (const date of dates) {
        const cell = rows[date]?.[zone.id];
        if (!cell) continue;
        if (cell.monthFutures !== null) {
          last = cell.monthFutures;
          lastTd = cell.monthTradeDate;
        } else if (last !== null) {
          cell.monthFutures = last;
          cell.monthTradeDate = lastTd;
          const dM = delta(last, cell.spot);
          cell.monthDeltaEur = dM.eur;
          cell.monthDeltaPct = dM.pct;
        }
      }
    }

    // —— Week / Weekend: якщо EEX public не дав settlPx — будуємо з Day-архіву ——
    // Week = середнє day-futures по днях ISO-тижня; Weekend = сб+нд
    function isoWeekKey(iso: string): string {
      const m = isoWeekMaturity(iso);
      return String(m);
    }
    function weekdayUTC(iso: string): number {
      // 0=Sun .. 6=Sat in JS; convert to Mon=1..Sun=7
      const d = new Date(`${iso}T12:00:00Z`).getUTCDay();
      return d === 0 ? 7 : d;
    }
    // group dates by ISO week
    const byWeek = new Map<string, string[]>();
    for (const d of dates) {
      const k = isoWeekKey(d);
      if (!byWeek.has(k)) byWeek.set(k, []);
      byWeek.get(k)!.push(d);
    }
    for (const zone of ZONES) {
      for (const [, weekDates] of byWeek) {
        const dayVals: number[] = [];
        const weVals: number[] = [];
        for (const d of weekDates) {
          const px = rows[d]?.[zone.id]?.dayFutures;
          if (px === null || px === undefined) continue;
          dayVals.push(px);
          const wd = weekdayUTC(d);
          if (wd >= 6) weVals.push(px); // Sat=6 Sun=7
        }
        const weekAvg = dayVals.length
          ? Math.round((dayVals.reduce((a, b) => a + b, 0) / dayVals.length) * 100) / 100
          : null;
        const weAvg = weVals.length
          ? Math.round((weVals.reduce((a, b) => a + b, 0) / weVals.length) * 100) / 100
          : null;
        for (const d of weekDates) {
          const cell = rows[d]?.[zone.id];
          if (!cell) continue;
          // only fill if EEX did not provide
          if (cell.weekFutures === null && weekAvg !== null) {
            cell.weekFutures = weekAvg;
            const dW = delta(weekAvg, cell.spot);
            cell.weekDeltaEur = dW.eur;
            cell.weekDeltaPct = dW.pct;
          }
          if (cell.weekendFutures === null && weAvg !== null) {
            cell.weekendFutures = weAvg;
            const dWe = delta(weAvg, cell.spot);
            cell.weekendDeltaEur = dWe.eur;
            cell.weekendDeltaPct = dWe.pct;
          }
        }
      }
    }


    // Forward-fill Week / Weekend по зоні (усі дати періоду без пропусків)
    for (const zone of ZONES) {
      let lastW: number | null = null;
      let lastWe: number | null = null;
      for (const date of dates) {
        const cell = rows[date]?.[zone.id];
        if (!cell) continue;
        if (cell.weekFutures !== null) lastW = cell.weekFutures;
        else if (lastW !== null) {
          cell.weekFutures = lastW;
          const dW = delta(lastW, cell.spot);
          cell.weekDeltaEur = dW.eur;
          cell.weekDeltaPct = dW.pct;
        }
        if (cell.weekendFutures !== null) lastWe = cell.weekendFutures;
        else if (lastWe !== null) {
          cell.weekendFutures = lastWe;
          const dWe = delta(lastWe, cell.spot);
          cell.weekendDeltaEur = dWe.eur;
          cell.weekendDeltaPct = dWe.pct;
        }
      }
    }

    // EU avg + UA
    const euUa: DailyEuUa[] = dates.map((date) => {
      const zonePrices: number[] = [];
      for (const z of ZONES) {
        const px = rows[date]?.[z.id]?.spot;
        if (px !== null && px !== undefined) zonePrices.push(px);
      }
      const euAvg = mean(zonePrices);
      const uaUahPx = uaUah[date] ?? null;
      const uaRdnEur =
        uaUahPx !== null && eurUah > 0 ? Math.round((uaUahPx / eurUah) * 100) / 100 : null;
      let deltaPct: number | null = null;
      if (uaRdnEur !== null && euAvg !== null && euAvg !== 0) {
        deltaPct = Math.round(((uaRdnEur - euAvg) / euAvg) * 10000) / 100;
      }
      return { date, euAvg, uaRdnEur, uaRdnUah: uaUahPx, deltaPct, eurUah };
    });

    // Декади: середні SPOT / DAY / WEEK + дельти + знижки 30/20/10
    const decadeKeys = new Map<string, { start: string; end: string; label: string }>();
    for (const d of dates) {
      const b = decadeBounds(d);
      decadeKeys.set(b.label, b);
    }
    const decades: DecadeSummary[] = [...decadeKeys.values()].map((b) => {
      const spots: number[] = [];
      const days: number[] = [];
      const weeks: number[] = [];
      const weekends: number[] = [];
      for (const d of dates) {
        if (d < b.start || d > b.end) continue;
        // EU avg spot for the day
        const eu = euUa.find((x) => x.date === d)?.euAvg;
        if (eu !== null && eu !== undefined) spots.push(eu);
        // average day/week/weekend futures across zones that have them
        const dayVals: number[] = [];
        const weekVals: number[] = [];
        const weVals: number[] = [];
        for (const z of ZONES) {
          const c = rows[d]?.[z.id];
          if (!c) continue;
          if (c.dayFutures !== null) dayVals.push(c.dayFutures);
          if (c.weekFutures !== null) weekVals.push(c.weekFutures);
          if (c.weekendFutures !== null) weVals.push(c.weekendFutures);
        }
        const dm = mean(dayVals);
        const wm = mean(weekVals);
        const wem = mean(weVals);
        if (dm !== null) days.push(dm);
        if (wm !== null) weeks.push(wm);
        if (wem !== null) weekends.push(wem);
      }
      const euAvgEur = mean(spots);
      const dayAvg = mean(days);
      const weekAvg = mean(weeks);
      const weekendAvg = mean(weekends);
      const dDay = delta(dayAvg, euAvgEur);
      const dWeek = delta(weekAvg, euAvgEur);
      const disc = (pct: number) =>
        euAvgEur === null ? null : Math.round(euAvgEur * (1 - pct / 100) * 100) / 100;
      const toUah = (eur: number | null) =>
        eur === null ? null : Math.round(eur * eurUah * 100) / 100;
      return {
        label: b.label,
        periodStart: b.start,
        periodEnd: b.end,
        euAvgEur,
        dayAvgEur: dayAvg,
        weekAvgEur: weekAvg,
        weekendAvgEur: weekendAvg,
        dayDeltaEur: dDay.eur,
        dayDeltaPct: dDay.pct,
        weekDeltaEur: dWeek.eur,
        weekDeltaPct: dWeek.pct,
        disc30Eur: disc(30),
        disc20Eur: disc(20),
        disc10Eur: disc(10),
        disc30Uah: toUah(disc(30)),
        disc20Uah: toUah(disc(20)),
        disc10Uah: toUah(disc(10)),
        eurUah,
      };
    });

    const dayZones = ZONES.filter((z) => z.dayPrefix);
    const dayHits = dates.reduce((acc, d) => {
      return acc + dayZones.filter((z) => rows[d][z.id].dayFutures !== null).length;
    }, 0);
    if (dayHits === 0) {
      warnings.push(
        "Подобові ф'ючерси (архів до поставки) не знайдені — EEX міг ще не опублікувати settlement.",
      );
    }
        const weekHits = dates.reduce((acc, d) => {
      return acc + ZONES.filter((z) => rows[d][z.id].weekFutures !== null).length;
    }, 0);
    if (weekHits === 0) {
      warnings.push(
        "Week/Weekend: публічний EEX не віддає settlPx — пораховано як середнє Day-архіву по тижню/вихідних.",
      );
    } else {
      warnings.push(
        "Week/Weekend: де можливо — EEX; інакше середнє Day-архіву (публічний feed часто без settlement для Week).",
      );
    }
    if (euUa.every((x) => x.uaRdnEur === null)) {
      warnings.push("UA РДН (Energy-Charts UA-IPS) не знайдено за період.");
    }

    return {
      startDate,
      endDate,
      fetchedAt: new Date().toISOString(),
      dates,
      zones: ZONES.map((z) => z.id),
      rows,
      euUa,
      decades,
      warnings,
      sources: {
        eex: "EEX Day+Month settlement; Week/Weekend = Day-архів середнє (EEX public без settlPx)",
        spot: "Energy-Charts / Fraunhofer ISE — Day Ahead Auction",
        ua: "Energy-Charts UA-IPS (UAH) → EUR за курсом НБУ",
      },
    };
  });
