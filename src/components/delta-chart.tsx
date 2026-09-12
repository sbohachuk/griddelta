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
import { ZONE_BY_ID } from "@/lib/zones";
import type { MarketReport } from "@/lib/market-types";

export function DeltaChart({ report, zone }: { report: MarketReport; zone: ZoneId }) {
  const meta = ZONE_BY_ID[zone];
  const data = report.dates.map((date) => {
    const cell = report.rows[date]?.[zone];
    return {
      date: date.slice(5),
      spot: cell?.spot ?? null,
      day: cell?.dayFutures ?? null,
      month: cell?.monthFutures ?? null,
    };
  });

  return (
    <div className="h-[280px] w-full sm:h-[320px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="color-mix(in oklab, var(--color-foreground) 8%, transparent)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
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
              const key = String(name);
              const label =
                key === "spot" ? "Spot" : key === "day" ? "Day futures" : "Month futures";
              return [`${n} €/MWh`, label];
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, color: "var(--color-muted-foreground)" }}
            formatter={(value) =>
              value === "spot" ? "Spot" : value === "day" ? "Day futures" : "Month futures"
            }
          />
          <Line
            type="monotone"
            dataKey="spot"
            stroke="var(--color-foreground)"
            strokeWidth={2}
            dot={false}
            connectNulls
            name="spot"
          />
          {meta.dayPrefix ? (
            <Line
              type="monotone"
              dataKey="day"
              stroke="var(--color-gain)"
              strokeWidth={2}
              dot={false}
              connectNulls
              name="day"
            />
          ) : null}
          <Line
            type="monotone"
            dataKey="month"
            stroke="var(--color-muted-foreground)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            dot={false}
            connectNulls
            name="month"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
