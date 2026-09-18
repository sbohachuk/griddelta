import { useMemo } from "react";
import { ZONES, type ZoneId } from "@/lib/zones";
import type { CellQuote, MarketReport } from "@/lib/market-types";
import { cn, formatPct, formatPrice, formatDateWithWeek } from "@/lib/utils";
import { buildZoneDecades, buildZoneMonth } from "@/lib/zone-period";

type Metric =
  | "spot"
  | "dayFutures"
  | "weekFutures"
  | "weekendFutures"
  | "monthFutures"
  | "dayDeltaEur"
  | "dayDeltaPct"
  | "weekDeltaEur"
  | "weekDeltaPct"
  | "weekendDeltaEur"
  | "weekendDeltaPct"
  | "monthDeltaEur"
  | "monthDeltaPct";

const METRIC_META: Record<Metric, { title: string; isDelta: boolean; isPct: boolean }> = {
  spot: { title: "Spot · Energy-Charts", isDelta: false, isPct: false },
  dayFutures: { title: "Day futures · архів ДО поставки", isDelta: false, isPct: false },
  weekFutures: { title: "Week futures · EEX calendar YYYYWW", isDelta: false, isPct: false },
  weekendFutures: { title: "Weekend futures · EEX", isDelta: false, isPct: false },
  monthFutures: { title: "Month futures · EEX Base Month", isDelta: false, isPct: false },
  dayDeltaEur: { title: "Δ day · EUR/MWh", isDelta: true, isPct: false },
  dayDeltaPct: { title: "Δ day · %", isDelta: true, isPct: true },
  weekDeltaEur: { title: "Δ week · EUR/MWh", isDelta: true, isPct: false },
  weekDeltaPct: { title: "Δ week · %", isDelta: true, isPct: true },
  weekendDeltaEur: { title: "Δ weekend · EUR/MWh", isDelta: true, isPct: false },
  weekendDeltaPct: { title: "Δ weekend · %", isDelta: true, isPct: true },
  monthDeltaEur: { title: "Δ month · EUR/MWh", isDelta: true, isPct: false },
  monthDeltaPct: { title: "Δ month · %", isDelta: true, isPct: true },
};

function read(cell: CellQuote | undefined, metric: Metric): number | null {
  if (!cell) return null;
  return cell[metric];
}

function isMissingZone(metric: Metric, z: (typeof ZONES)[number]): boolean {
  return (
    (metric.includes("day") &&
      metric !== "dayDeltaEur" &&
      metric !== "dayDeltaPct" &&
      !z.dayPrefix) ||
    (metric.includes("week") && !metric.includes("weekend") && !z.weekCode) ||
    (metric.includes("weekend") && !z.weekendCode)
  );
}

function rowAvg(
  report: MarketReport,
  date: string,
  metric: Metric,
  zones: typeof ZONES,
): number | null {
  const vals: number[] = [];
  for (const z of zones) {
    if (isMissingZone(metric, z)) continue;
    const v = read(report.rows[date]?.[z.id], metric);
    if (v != null && Number.isFinite(v)) vals.push(v);
  }
  if (!vals.length) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
}

export function PriceTable({
  report,
  metric,
  highlight,
}: {
  report: MarketReport;
  metric: Metric;
  highlight?: ZoneId;
}) {
  const meta = METRIC_META[metric];
  const zones = ZONES.filter((z) => report.zones.includes(z.id));

  return (
    <div className="overflow-hidden rounded-[calc(var(--radius-xl)-4px)] border border-border">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <caption className="sr-only">{meta.title}</caption>
          <thead>
            <tr className="bg-foreground text-background">
              <th className="sticky left-0 z-10 bg-foreground px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.12em]">
                Дата
              </th>
              {zones.map((z) => (
                <th
                  key={z.id}
                  className={cn(
                    "px-2 py-2.5 text-right text-[11px] font-medium uppercase tracking-[0.12em]",
                    highlight === z.id && "bg-background/15",
                  )}
                  title={z.name}
                >
                  {z.id}
                </th>
              ))}
              <th
                className="px-2 py-2.5 text-right text-[11px] font-medium uppercase tracking-[0.12em] bg-background/20"
                title="Середнє по всіх зонах"
              >
                Сер.
              </th>
            </tr>
          </thead>
          <tbody>
            {report.dates.map((date, i) => {
              const avg = rowAvg(report, date, metric, zones);
              return (
              <tr
                key={date}
                className={cn(
                  "border-t border-border",
                  i % 2 === 0 ? "bg-card" : "bg-muted/40",
                )}
              >
                <td className="sticky left-0 z-10 bg-inherit px-3 py-2 font-medium tabular-nums text-muted-foreground">
                  {formatDateWithWeek(date)}
                </td>
                {zones.map((z) => {
                  const value = read(report.rows[date]?.[z.id], metric);
                  const missing = isMissingZone(metric, z);
                  return (
                    <td
                      key={z.id}
                      className={cn(
                        "px-2 py-2 text-right tabular-nums",
                        highlight === z.id && "bg-foreground/4",
                        meta.isDelta && value !== null && value > 0 && "text-gain",
                        meta.isDelta && value !== null && value < 0 && "text-loss",
                      )}
                    >
                      {missing ? "—" : meta.isPct ? formatPct(value) : formatPrice(value)}
                    </td>
                  );
                })}
                <td
                  className={cn(
                    "px-2 py-2 text-right tabular-nums font-medium bg-foreground/5",
                    meta.isDelta && avg !== null && avg > 0 && "text-gain",
                    meta.isDelta && avg !== null && avg < 0 && "text-loss",
                  )}
                >
                  {meta.isPct ? formatPct(avg) : formatPrice(avg)}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function EuUaTable({ report }: { report: MarketReport }) {
  const rows = report.euUa ?? [];
  return (
    <div className="overflow-hidden rounded-[calc(var(--radius-xl)-4px)] border border-border">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="bg-foreground text-background">
              <th className="px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.12em]">
                Дата
              </th>
              <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">EU avg €</th>
              <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">UA РДН €</th>
              <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">UA ₴</th>
              <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">Δ %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={r.date}
                className={cn("border-t border-border", i % 2 === 0 ? "bg-card" : "bg-muted/40")}
              >
                <td className="px-3 py-2 font-medium tabular-nums text-muted-foreground">
                  {formatDateWithWeek(r.date)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{formatPrice(r.euAvg)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatPrice(r.uaRdnEur)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatPrice(r.uaRdnUah)}</td>
                <td
                  className={cn(
                    "px-2 py-2 text-right tabular-nums",
                    r.deltaPct !== null && r.deltaPct > 0 && "text-gain",
                    r.deltaPct !== null && r.deltaPct < 0 && "text-loss",
                  )}
                >
                  {formatPct(r.deltaPct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Середнє Week + Weekend по зонах (подобово) */
export function WeekWeekendAvgTable({
  report,
  highlight,
}: {
  report: MarketReport;
  highlight?: ZoneId;
}) {
  const zones = ZONES.filter((z) => report.zones.includes(z.id));

  function cellAvg(date: string, zoneId: ZoneId): number | null {
    const c = report.rows[date]?.[zoneId];
    if (!c) return null;
    const vals = [c.weekFutures, c.weekendFutures].filter(
      (v): v is number => v != null && Number.isFinite(v),
    );
    if (!vals.length) return null;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
  }

  function rowAvg(date: string): number | null {
    const vals: number[] = [];
    for (const z of zones) {
      const v = cellAvg(date, z.id);
      if (v != null) vals.push(v);
    }
    if (!vals.length) return null;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
  }

  return (
    <div className="overflow-hidden rounded-[calc(var(--radius-xl)-4px)] border border-border">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <caption className="sr-only">Середнє Week + Weekend</caption>
          <thead>
            <tr className="bg-foreground text-background">
              <th className="sticky left-0 z-10 bg-foreground px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.12em]">
                Дата
              </th>
              {zones.map((z) => (
                <th
                  key={z.id}
                  className={cn(
                    "px-2 py-2.5 text-right text-[11px] font-medium uppercase tracking-[0.12em]",
                    highlight === z.id && "bg-background/15",
                  )}
                  title={z.name}
                >
                  {z.id}
                </th>
              ))}
              <th
                className="px-2 py-2.5 text-right text-[11px] font-medium uppercase tracking-[0.12em] bg-background/20"
                title="Середнє по всіх зонах"
              >
                Сер.
              </th>
            </tr>
          </thead>
          <tbody>
            {report.dates.map((date, i) => {
              const avg = rowAvg(date);
              return (
                <tr
                  key={date}
                  className={cn(
                    "border-t border-border",
                    i % 2 === 0 ? "bg-card" : "bg-muted/40",
                  )}
                >
                  <td className="sticky left-0 z-10 bg-inherit px-3 py-2 font-medium tabular-nums text-muted-foreground">
                    {formatDateWithWeek(date)}
                  </td>
                  {zones.map((z) => {
                    const value = cellAvg(date, z.id);
                    return (
                      <td
                        key={z.id}
                        className={cn(
                          "px-2 py-2 text-right tabular-nums",
                          highlight === z.id && "bg-foreground/4",
                        )}
                      >
                        {formatPrice(value)}
                      </td>
                    );
                  })}
                  <td className="px-2 py-2 text-right tabular-nums font-medium bg-foreground/5">
                    {formatPrice(avg)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Декади EU: SPOT / DAY / WEEK / WEEKEND + UA РДН + дельти + знижки */
export function DecadeTable({ report }: { report: MarketReport }) {
  const rows = report.decades ?? [];
  return (
    <div className="overflow-hidden rounded-[calc(var(--radius-xl)-4px)] border border-border">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] border-collapse text-sm">
          <thead>
            <tr className="bg-foreground text-background">
              <th className="px-3 py-2.5 text-left text-[11px] font-medium uppercase">Декада</th>
              <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">SPOT €</th>
              <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">DAY €</th>
              <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">WEEK €</th>
              <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">WE €</th>
              <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">UA РДН €</th>
              <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">UA ₴</th>
              <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">Δ DAY €</th>
              <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">Δ DAY %</th>
              <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">Δ WEEK €</th>
              <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">Δ WEEK %</th>
              <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">−30% €</th>
              <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">−20% €</th>
              <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">−10% €</th>
              <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">−30% ₴</th>
              <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">−20% ₴</th>
              <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">−10% ₴</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d, i) => (
              <tr
                key={d.label}
                className={cn("border-t border-border", i % 2 === 0 ? "bg-card" : "bg-muted/40")}
              >
                <td className="px-3 py-2 font-medium">{d.label}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatPrice(d.euAvgEur)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatPrice(d.dayAvgEur)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatPrice(d.weekAvgEur)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatPrice(d.weekendAvgEur)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatPrice(d.uaRdnAvgEur)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatPrice(d.uaRdnAvgUah)}</td>
                <td
                  className={cn(
                    "px-2 py-2 text-right tabular-nums",
                    d.dayDeltaEur !== null && d.dayDeltaEur > 0 && "text-gain",
                    d.dayDeltaEur !== null && d.dayDeltaEur < 0 && "text-loss",
                  )}
                >
                  {formatPrice(d.dayDeltaEur)}
                </td>
                <td
                  className={cn(
                    "px-2 py-2 text-right tabular-nums",
                    d.dayDeltaPct !== null && d.dayDeltaPct > 0 && "text-gain",
                    d.dayDeltaPct !== null && d.dayDeltaPct < 0 && "text-loss",
                  )}
                >
                  {formatPct(d.dayDeltaPct)}
                </td>
                <td
                  className={cn(
                    "px-2 py-2 text-right tabular-nums",
                    d.weekDeltaEur !== null && d.weekDeltaEur > 0 && "text-gain",
                    d.weekDeltaEur !== null && d.weekDeltaEur < 0 && "text-loss",
                  )}
                >
                  {formatPrice(d.weekDeltaEur)}
                </td>
                <td
                  className={cn(
                    "px-2 py-2 text-right tabular-nums",
                    d.weekDeltaPct !== null && d.weekDeltaPct > 0 && "text-gain",
                    d.weekDeltaPct !== null && d.weekDeltaPct < 0 && "text-loss",
                  )}
                >
                  {formatPct(d.weekDeltaPct)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{formatPrice(d.disc30Eur)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatPrice(d.disc20Eur)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatPrice(d.disc10Eur)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatPrice(d.disc30Uah)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatPrice(d.disc20Uah)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatPrice(d.disc10Uah)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Середні за весь обраний період (місяць) — по кожній країні */
export function ZoneMonthTable({ report }: { report: MarketReport }) {
  const rows = useMemo(() => buildZoneMonth(report), [report]);
  return (
    <div className="overflow-hidden rounded-[calc(var(--radius-xl)-4px)] border border-border">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] border-collapse text-sm">
          <thead>
            <tr className="bg-foreground text-background">
              <th className="px-3 py-2.5 text-left text-[11px] font-medium uppercase">Зона</th>
              <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">SPOT €</th>
              <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">DAY €</th>
              <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">WEEK €</th>
              <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">WE €</th>
              <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">MONTH €</th>
              <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">Δ DAY €</th>
              <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">Δ DAY %</th>
              <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">Δ MONTH €</th>
              <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">Δ MONTH %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const z = ZONES.find((x) => x.id === r.zoneId);
              return (
                <tr
                  key={r.zoneId}
                  className={cn("border-t border-border", i % 2 === 0 ? "bg-card" : "bg-muted/40")}
                >
                  <td className="px-3 py-2 font-medium">
                    {r.zoneId}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">{z?.name}</span>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatPrice(r.spotAvg)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatPrice(r.dayAvg)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatPrice(r.weekAvg)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatPrice(r.weekendAvg)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatPrice(r.monthAvg)}</td>
                  <td
                    className={cn(
                      "px-2 py-2 text-right tabular-nums",
                      r.dayDeltaEur != null && r.dayDeltaEur > 0 && "text-gain",
                      r.dayDeltaEur != null && r.dayDeltaEur < 0 && "text-loss",
                    )}
                  >
                    {formatPrice(r.dayDeltaEur)}
                  </td>
                  <td
                    className={cn(
                      "px-2 py-2 text-right tabular-nums",
                      r.dayDeltaPct != null && r.dayDeltaPct > 0 && "text-gain",
                      r.dayDeltaPct != null && r.dayDeltaPct < 0 && "text-loss",
                    )}
                  >
                    {formatPct(r.dayDeltaPct)}
                  </td>
                  <td
                    className={cn(
                      "px-2 py-2 text-right tabular-nums",
                      r.monthDeltaEur != null && r.monthDeltaEur > 0 && "text-gain",
                      r.monthDeltaEur != null && r.monthDeltaEur < 0 && "text-loss",
                    )}
                  >
                    {formatPrice(r.monthDeltaEur)}
                  </td>
                  <td
                    className={cn(
                      "px-2 py-2 text-right tabular-nums",
                      r.monthDeltaPct != null && r.monthDeltaPct > 0 && "text-gain",
                      r.monthDeltaPct != null && r.monthDeltaPct < 0 && "text-loss",
                    )}
                  >
                    {formatPct(r.monthDeltaPct)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Декади × кожна країна */
export function ZoneDecadeTable({ report }: { report: MarketReport }) {
  const rows = useMemo(() => buildZoneDecades(report), [report]);
  const labels = useMemo(() => [...new Set(rows.map((r) => r.label))], [rows]);

  return (
    <div className="space-y-4">
      {labels.map((label) => {
        const slice = rows.filter((r) => r.label === label);
        return (
          <div
            key={label}
            className="overflow-hidden rounded-[calc(var(--radius-xl)-4px)] border border-border"
          >
            <div className="border-b border-border bg-muted/30 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Декада {label}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] border-collapse text-sm">
                <thead>
                  <tr className="bg-foreground text-background">
                    <th className="px-3 py-2.5 text-left text-[11px] font-medium uppercase">Зона</th>
                    <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">SPOT €</th>
                    <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">DAY €</th>
                    <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">WEEK €</th>
                    <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">WE €</th>
                    <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">MONTH €</th>
                    <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">Δ DAY €</th>
                    <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">Δ DAY %</th>
                    <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">Δ MONTH €</th>
                    <th className="px-2 py-2.5 text-right text-[11px] font-medium uppercase">Δ MONTH %</th>
                  </tr>
                </thead>
                <tbody>
                  {slice.map((r, i) => {
                    const z = ZONES.find((x) => x.id === r.zoneId);
                    return (
                      <tr
                        key={r.zoneId}
                        className={cn(
                          "border-t border-border",
                          i % 2 === 0 ? "bg-card" : "bg-muted/40",
                        )}
                      >
                        <td className="px-3 py-2 font-medium">
                          {r.zoneId}
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            {z?.name}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatPrice(r.spotAvg)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatPrice(r.dayAvg)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatPrice(r.weekAvg)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatPrice(r.weekendAvg)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatPrice(r.monthAvg)}</td>
                        <td
                          className={cn(
                            "px-2 py-2 text-right tabular-nums",
                            r.dayDeltaEur != null && r.dayDeltaEur > 0 && "text-gain",
                            r.dayDeltaEur != null && r.dayDeltaEur < 0 && "text-loss",
                          )}
                        >
                          {formatPrice(r.dayDeltaEur)}
                        </td>
                        <td
                          className={cn(
                            "px-2 py-2 text-right tabular-nums",
                            r.dayDeltaPct != null && r.dayDeltaPct > 0 && "text-gain",
                            r.dayDeltaPct != null && r.dayDeltaPct < 0 && "text-loss",
                          )}
                        >
                          {formatPct(r.dayDeltaPct)}
                        </td>
                        <td
                          className={cn(
                            "px-2 py-2 text-right tabular-nums",
                            r.monthDeltaEur != null && r.monthDeltaEur > 0 && "text-gain",
                            r.monthDeltaEur != null && r.monthDeltaEur < 0 && "text-loss",
                          )}
                        >
                          {formatPrice(r.monthDeltaEur)}
                        </td>
                        <td
                          className={cn(
                            "px-2 py-2 text-right tabular-nums",
                            r.monthDeltaPct != null && r.monthDeltaPct > 0 && "text-gain",
                            r.monthDeltaPct != null && r.monthDeltaPct < 0 && "text-loss",
                          )}
                        >
                          {formatPct(r.monthDeltaPct)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
