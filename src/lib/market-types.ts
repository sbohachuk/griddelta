import type { ZoneId } from "./zones";

export type CellQuote = {
  spot: number | null;
  dayFutures: number | null;
  weekFutures: number | null;
  weekendFutures: number | null;
  monthFutures: number | null;
  dayDeltaEur: number | null;
  dayDeltaPct: number | null;
  weekDeltaEur: number | null;
  weekDeltaPct: number | null;
  weekendDeltaEur: number | null;
  weekendDeltaPct: number | null;
  monthDeltaEur: number | null;
  monthDeltaPct: number | null;
  dayTradeDate: string | null;
  weekTradeDate: string | null;
  weekendTradeDate: string | null;
  monthTradeDate: string | null;
};

export type DailyEuUa = {
  date: string;
  euAvg: number | null;
  uaRdnEur: number | null;
  uaRdnUah: number | null;
  deltaPct: number | null;
  eurUah: number | null;
};

export type DecadeSummary = {
  label: string;
  periodStart: string;
  periodEnd: string;
  /** Середній spot Європи за декаду */
  euAvgEur: number | null;
  /** Середній day-futures (архів) за декаду */
  dayAvgEur: number | null;
  weekAvgEur: number | null;
  weekendAvgEur: number | null;
  dayDeltaEur: number | null;
  dayDeltaPct: number | null;
  weekDeltaEur: number | null;
  weekDeltaPct: number | null;
  disc30Eur: number | null;
  disc20Eur: number | null;
  disc10Eur: number | null;
  disc30Uah: number | null;
  disc20Uah: number | null;
  disc10Uah: number | null;
  eurUah: number | null;
};

export type MarketReport = {
  startDate: string;
  endDate: string;
  fetchedAt: string;
  dates: string[];
  zones: ZoneId[];
  rows: Record<string, Record<ZoneId, CellQuote>>;
  euUa: DailyEuUa[];
  decades: DecadeSummary[];
  warnings: string[];
  sources: { eex: string; spot: string; ua: string };
};

export type LoadMarketInput = {
  startDate: string;
  endDate: string;
  /** spot = швидкий шар (РДН); full = повний звіт */
  phase?: "spot" | "full";
};
