import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ZoneId } from "@/lib/zones";
import { ZONES, ZONE_BY_ID } from "@/lib/zones";
import type { MarketReport } from "@/lib/market-types";
import { cn, formatDateWithWeek, isoWeekNumber } from "@/lib/utils";

const ZONE_COLORS: Record<string, string> = {
  DE: "#e8e6dc",
  AT: "#7dd3fc",
  FR: "#c4b5fd",
  CZ: "#86efac",
  HU: "#fcd34d",
  SK: "#f9a8d4",
  RO: "#fdba74",
  PL: "#a5b4fc",
  BG: "#67e8f9",
  UA: "#f87171",
  EU: "#a3a3a3",
};

/** Подобовий графік зони: Spot · Day · Month + UA РДН */
export function DeltaChart({ report, zone }: { report: MarketReport; zone: ZoneId }) {
  const meta = ZONE_BY_ID[zone];
  const uaByDate = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const row of report.euUa ?? []) m.set(row.date, row.uaRdnEur);
    return m;
  }, [report.euUa]);

  const data = report.dates.map((date) => {
    const cell = report.rows[date]?.[zone];
    return {
      date: formatDateWithWeek(date),
      raw: date,
      spot: cell?.spot ?? null,
      day: cell?.dayFutures ?? null,
      month: cell?.monthFutures ?? null,
      week: cell?.weekFutures ?? null,
      ua: uaByDate.get(date) ?? null,
    };
  });

  return (
    <div className="h-[280px] w-full sm:h-[320px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid
            stroke="color-mix(in oklab, var(--color-foreground) 8%, transparent)"
            vertical={false}
          />
          <XAxis
            dataKey="date"
            tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={28}
          />
          <YAxis
            tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={48}
          />
          <Tooltip
            contentStyle={{
              background: "var(--color-card)",
              border: "1px solid var(--color-border)",
              borderRadius: 12,
              color: "var(--color-foreground)",
              fontSize: 12,
            }}
            labelFormatter={(label, payload) => {
              const raw = payload?.[0]?.payload?.raw as string | undefined;
              if (raw) return `${raw} · W${String(isoWeekNumber(raw)).padStart(2, "0")}`;
              return String(label);
            }}
            formatter={(value, name) => {
              const n = typeof value === "number" ? value.toFixed(2) : "—";
              const labels: Record<string, string> = {
                spot: "Spot",
                day: "Day futures",
                month: "Month futures",
                week: "Week futures",
                ua: "UA РДН",
              };
              return [`${n} €/MWh`, labels[String(name)] ?? String(name)];
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, color: "var(--color-muted-foreground)" }}
            formatter={(value) =>
              ({
                spot: "Spot",
                day: "Day",
                month: "Month",
                week: "Week",
                ua: "UA РДН",
              })[value] ?? value
            }
          />
          <Line type="monotone" dataKey="spot" stroke={ZONE_COLORS.DE} strokeWidth={2} dot={false} connectNulls name="spot" />
          {meta.dayPrefix ? (
            <Line type="monotone" dataKey="day" stroke="#38bdf8" strokeWidth={2} dot={false} connectNulls name="day" />
          ) : null}
          <Line type="monotone" dataKey="week" stroke="#a78bfa" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls name="week" />
          <Line type="monotone" dataKey="month" stroke="#fbbf24" strokeWidth={1.5} strokeDasharray="2 2" dot={false} connectNulls name="month" />
          <Line type="monotone" dataKey="ua" stroke={ZONE_COLORS.UA} strokeWidth={2} dot={false} connectNulls name="ua" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Загальний графік spot усіх країн + UA + EU — можна вмикати/вимикати серії */
export function OverviewChart({ report }: { report: MarketReport }) {
  const allIds = useMemo(() => [...ZONES.map((z) => z.id), "UA", "EU"] as const, []);
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(allIds.map((id) => [id, true])),
  );

  const uaByDate = useMemo(() => {
    const m = new Map<string, { ua: number | null; eu: number | null }>();
    for (const row of report.euUa ?? []) m.set(row.date, { ua: row.uaRdnEur, eu: row.euAvg });
    return m;
  }, [report.euUa]);

  const data = report.dates.map((date) => {
    const row: Record<string, string | number | null> = {
      date: formatDateWithWeek(date),
      raw: date,
    };
    for (const z of ZONES) {
      row[z.id] = report.rows[date]?.[z.id]?.spot ?? null;
    }
    const euUa = uaByDate.get(date);
    row.UA = euUa?.ua ?? null;
    row.EU = euUa?.eu ?? null;
    return row;
  });

  function setAll(on: boolean) {
    setEnabled(Object.fromEntries(allIds.map((id) => [id, on])));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setAll(true)}
          className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Усі
        </button>
        <button
          type="button"
          onClick={() => setAll(false)}
          className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Жодної
        </button>
        {allIds.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setEnabled((s) => ({ ...s, [id]: !s[id] }))}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              enabled[id]
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground",
            )}
            style={
              enabled[id]
                ? { borderColor: ZONE_COLORS[id], background: ZONE_COLORS[id], color: "#0c0d11" }
                : undefined
            }
          >
            {id}
          </button>
        ))}
      </div>
      <div className="h-[300px] w-full sm:h-[360px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid
              stroke="color-mix(in oklab, var(--color-foreground) 8%, transparent)"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={28}
            />
            <YAxis
              tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={48}
            />
            <Tooltip
              contentStyle={{
                background: "var(--color-card)",
                border: "1px solid var(--color-border)",
                borderRadius: 12,
                color: "var(--color-foreground)",
                fontSize: 12,
              }}
              formatter={(value, name) => {
                const n = typeof value === "number" ? value.toFixed(2) : "—";
                return [`${n} €/MWh`, String(name)];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: "var(--color-muted-foreground)" }} />
            {allIds.map((id) =>
              enabled[id] ? (
                <Line
                  key={id}
                  type="monotone"
                  dataKey={id}
                  stroke={ZONE_COLORS[id] ?? "#888"}
                  strokeWidth={id === "UA" || id === "EU" ? 2.5 : 1.5}
                  strokeDasharray={id === "EU" ? "4 3" : undefined}
                  dot={false}
                  connectNulls
                  name={id}
                />
              ) : null,
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
