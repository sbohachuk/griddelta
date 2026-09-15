import { ZONES, type ZoneId } from "./zones";
import type { CellQuote, MarketReport, ZonePeriodSummary } from "./market-types";
import { decadeBounds } from "./market-eex";

function mean(vals: number[]): number | null {
  if (!vals.length) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
}

function delta(
  futures: number | null,
  spot: number | null,
): { eur: number | null; pct: number | null } {
  if (futures === null || spot === null || spot === 0) return { eur: null, pct: null };
  const eur = Math.round((futures - spot) * 100) / 100;
  const pct = Math.round(((futures - spot) / spot) * 10000) / 100;
  return { eur, pct };
}

function collect(
  rows: MarketReport["rows"],
  dates: string[],
  zoneId: ZoneId,
  periodStart: string,
  periodEnd: string,
  label: string,
): ZonePeriodSummary {
  const spots: number[] = [];
  const days: number[] = [];
  const weeks: number[] = [];
  const weekends: number[] = [];
  const months: number[] = [];
  for (const d of dates) {
    if (d < periodStart || d > periodEnd) continue;
    const c: CellQuote | undefined = rows[d]?.[zoneId];
    if (!c) continue;
    if (c.spot != null) spots.push(c.spot);
    if (c.dayFutures != null) days.push(c.dayFutures);
    if (c.weekFutures != null) weeks.push(c.weekFutures);
    if (c.weekendFutures != null) weekends.push(c.weekendFutures);
    if (c.monthFutures != null) months.push(c.monthFutures);
  }
  const spotAvg = mean(spots);
  const dayAvg = mean(days);
  const weekAvg = mean(weeks);
  const weekendAvg = mean(weekends);
  const monthAvg = mean(months);
  const dDay = delta(dayAvg, spotAvg);
  const dMonth = delta(monthAvg, spotAvg);
  return {
    zoneId,
    label,
    periodStart,
    periodEnd,
    spotAvg,
    dayAvg,
    weekAvg,
    weekendAvg,
    monthAvg,
    dayDeltaEur: dDay.eur,
    dayDeltaPct: dDay.pct,
    monthDeltaEur: dMonth.eur,
    monthDeltaPct: dMonth.pct,
  };
}

/** Середні за весь обраний період (місяць / діапазон) по кожній зоні */
export function buildZoneMonth(report: MarketReport): ZonePeriodSummary[] {
  const label =
    report.startDate.slice(0, 7) === report.endDate.slice(0, 7)
      ? report.startDate.slice(0, 7)
      : `${report.startDate}…${report.endDate}`;
  return ZONES.map((z) =>
    collect(report.rows, report.dates, z.id, report.startDate, report.endDate, label),
  );
}

/** Декади (1–10 / 11–20 / 21–кінець) × кожна зона */
export function buildZoneDecades(report: MarketReport): ZonePeriodSummary[] {
  const decadeKeys = new Map<string, { start: string; end: string; label: string }>();
  for (const d of report.dates) {
    const b = decadeBounds(d);
    decadeKeys.set(b.label, b);
  }
  const out: ZonePeriodSummary[] = [];
  for (const b of decadeKeys.values()) {
    for (const z of ZONES) {
      out.push(collect(report.rows, report.dates, z.id, b.start, b.end, b.label));
    }
  }
  return out;
}

export type CountryProduct = "spot" | "day" | "week" | "month";

/** Значення продукту з комірки для графіка порівняння країн */
export function cellProduct(
  cell: CellQuote | undefined,
  product: CountryProduct,
): number | null {
  if (!cell) return null;
  if (product === "spot") return cell.spot;
  if (product === "day") return cell.dayFutures;
  if (product === "month") return cell.monthFutures;
  // week = Week + Weekend (середнє, якщо є хоч одне)
  const vals = [cell.weekFutures, cell.weekendFutures].filter(
    (v): v is number => v != null && Number.isFinite(v),
  );
  if (!vals.length) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
}
