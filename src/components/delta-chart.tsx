import { useEffect, useMemo, useState } from "react";
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
import { cellProduct, type CountryProduct } from "@/lib/zone-period";

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

const PRODUCT_COLORS: Record<string, string> = {
  spot: "#e8e6dc",
  day: "#38bdf8",
  week: "#a78bfa",
  month: "#fbbf24",
  ua: "#f87171",
};

type Currency = "EUR" | "UAH";

function useEurUah(report: MarketReport): number {
  return useMemo(() => {
    for (let i = (report.euUa?.length ?? 0) - 1; i >= 0; i--) {
      const r = report.euUa![i]?.eurUah;
      if (r && r > 0) return r;
    }
    return 46.5;
  }, [report.euUa]);
}

function convert(v: number | null | undefined, currency: Currency, rate: number): number | null {
  if (v === null || v === undefined) return null;
  if (currency === "EUR") return Math.round(v * 100) / 100;
  return Math.round(v * rate * 100) / 100;
}

function unitLabel(currency: Currency): string {
  return currency === "EUR" ? "€/MWh" : "₴/MWh";
}

function CurrencyToggle({
  currency,
  onChange,
  rate,
}: {
  currency: Currency;
  onChange: (c: Currency) => void;
  rate: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-full border border-border p-0.5 text-xs">
        <button
          type="button"
          onClick={() => onChange("EUR")}
          className={cn(
            "rounded-full px-3 py-1 font-medium transition-colors",
            currency === "EUR" ? "bg-foreground text-background" : "text-muted-foreground",
          )}
        >
          € EUR
        </button>
        <button
          type="button"
          onClick={() => onChange("UAH")}
          className={cn(
            "rounded-full px-3 py-1 font-medium transition-colors",
            currency === "UAH" ? "bg-foreground text-background" : "text-muted-foreground",
          )}
        >
          ₴ UAH
        </button>
      </div>
      <span className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground">
        Курс НБУ: <span className="font-medium text-foreground">{rate.toFixed(4)}</span> ₴/€
      </span>
    </div>
  );
}

function yDomain(data: Record<string, unknown>[], keys: string[]): [number | "auto", number | "auto"] {
  let min = Infinity;
  let max = -Infinity;
  for (const row of data) {
    for (const k of keys) {
      const v = row[k];
      if (typeof v === "number" && Number.isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return ["auto", "auto"];
  const pad = Math.max((max - min) * 0.08, max * 0.02, 1);
  return [Math.max(0, Math.floor(min - pad)), Math.ceil(max + pad)];
}

function meanOf(vals: (number | null)[]): number | null {
  const xs = vals.filter((v): v is number => v !== null && Number.isFinite(v));
  if (!xs.length) return null;
  return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100;
}

/** Середнє продукту по обраних зонах за один день */
function avgProduct(
  report: MarketReport,
  date: string,
  zones: ZoneId[],
  product: CountryProduct,
): number | null {
  const vals: number[] = [];
  for (const z of zones) {
    const v = cellProduct(report.rows[date]?.[z], product);
    if (v != null) vals.push(v);
  }
  return meanOf(vals);
}

/**
 * Подобовий графік: мультивибір країн (без UA) → середні Spot / Day / Week+WE / Month.
 * Якщо обрана одна країна — додається UA РДН для порівняння.
 */
export function DeltaChart({
  report,
  zone,
}: {
  report: MarketReport;
  zone: ZoneId;
}) {
  const [currency, setCurrency] = useState<Currency>("EUR");
  const rate = useEurUah(report);
  const [selected, setSelected] = useState<Record<ZoneId, boolean>>(() =>
    Object.fromEntries(ZONES.map((z) => [z.id, z.id === zone])) as Record<ZoneId, boolean>,
  );

  // Синхрон з чіпом зони в дашборді: якщо змінили зону ззовні — увімкнути її
  useEffect(() => {
    setSelected((prev) => {
      if (prev[zone]) return prev;
      return { ...prev, [zone]: true };
    });
  }, [zone]);

  const selectedZones = useMemo(
    () => ZONES.filter((z) => selected[z.id]).map((z) => z.id),
    [selected],
  );

  const uaByDate = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const row of report.euUa ?? []) m.set(row.date, row.uaRdnEur);
    return m;
  }, [report.euUa]);

  const data = report.dates.map((date) => {
    const zones = selectedZones.length ? selectedZones : ([zone] as ZoneId[]);
    return {
      date: formatDateWithWeek(date),
      dayLabel: date.slice(8, 10),
      raw: date,
      spot: convert(avgProduct(report, date, zones, "spot"), currency, rate),
      day: convert(avgProduct(report, date, zones, "day"), currency, rate),
      week: convert(avgProduct(report, date, zones, "week"), currency, rate),
      month: convert(avgProduct(report, date, zones, "month"), currency, rate),
      ua:
        zones.length === 1
          ? convert(uaByDate.get(date) ?? null, currency, rate)
          : null,
    };
  });

  const keys =
    selectedZones.length === 1 ? ["spot", "day", "week", "month", "ua"] : ["spot", "day", "week", "month"];
  const domain = yDomain(data, keys);
  const unit = unitLabel(currency);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const toggleKey = (key: string) => setHidden((prev) => ({ ...prev, [key]: !prev[key] }));

  const legendLabels: Record<string, string> = {
    spot: "Spot",
    day: "Day",
    month: "Month",
    week: "Week+WE",
    ua: "UA РДН",
  };

  function setAll(on: boolean) {
    setSelected(Object.fromEntries(ZONES.map((z) => [z.id, on])) as Record<ZoneId, boolean>);
  }

  const titleHint =
    selectedZones.length === 0
      ? "Оберіть хоча б одну країну"
      : selectedZones.length === 1
        ? `${ZONE_BY_ID[selectedZones[0]!]?.name ?? selectedZones[0]} · продукти + UA РДН`
        : `Середнє по ${selectedZones.length} країнах: ${selectedZones.join(", ")}`;

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
        {ZONES.map((z) => (
          <button
            key={z.id}
            type="button"
            onClick={() => setSelected((s) => ({ ...s, [z.id]: !s[z.id] }))}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              selected[z.id]
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground",
            )}
            style={
              selected[z.id]
                ? {
                    borderColor: ZONE_COLORS[z.id],
                    background: ZONE_COLORS[z.id],
                    color: "#0c0d11",
                  }
                : undefined
            }
            title={z.name}
          >
            {z.id}
            {!z.dayPrefix ? <span className="ml-0.5 text-[9px] opacity-70">M</span> : null}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{titleHint}</p>
      <CurrencyToggle currency={currency} onChange={setCurrency} rate={rate} />
      <div className="h-[280px] w-full sm:h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
            <CartesianGrid
              stroke="color-mix(in oklab, var(--color-foreground) 8%, transparent)"
              vertical={false}
            />
            <XAxis
              dataKey="dayLabel"
              tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              interval={0}
              minTickGap={8}
              height={28}
            />
            <YAxis
              domain={domain}
              tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={52}
              tickFormatter={(v) => (typeof v === "number" ? String(Math.round(v)) : String(v))}
            />
            <Tooltip
              contentStyle={{
                background: "var(--color-card)",
                border: "1px solid var(--color-border)",
                borderRadius: 12,
                color: "var(--color-foreground)",
                fontSize: 12,
              }}
              labelFormatter={(_label, payload) => {
                const raw = payload?.[0]?.payload?.raw as string | undefined;
                if (raw) return `${raw} · W${String(isoWeekNumber(raw)).padStart(2, "0")}`;
                return String(_label);
              }}
              formatter={(value, name) => {
                const n = typeof value === "number" ? value.toFixed(2) : "—";
                return [`${n} ${unit}`, legendLabels[String(name)] ?? String(name)];
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 12, color: "var(--color-muted-foreground)" }}
              onClick={(e) => toggleKey(String(e.dataKey))}
              formatter={(value, entry) => {
                const key = String((entry as { dataKey?: string })?.dataKey ?? value);
                const isHidden = hidden[key];
                return (
                  <span
                    style={{
                      cursor: "pointer",
                      opacity: isHidden ? 0.4 : 1,
                      textDecoration: isHidden ? "line-through" : "none",
                    }}
                  >
                    {legendLabels[value] ?? value}
                  </span>
                );
              }}
            />
            <Line
              type="monotone"
              dataKey="spot"
              stroke={PRODUCT_COLORS.spot}
              strokeWidth={2}
              dot={false}
              connectNulls
              name="spot"
              hide={hidden.spot}
            />
            <Line
              type="monotone"
              dataKey="day"
              stroke={PRODUCT_COLORS.day}
              strokeWidth={2}
              dot={false}
              connectNulls
              name="day"
              hide={hidden.day}
            />
            <Line
              type="monotone"
              dataKey="week"
              stroke={PRODUCT_COLORS.week}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              connectNulls
              name="week"
              hide={hidden.week}
            />
            <Line
              type="monotone"
              dataKey="month"
              stroke={PRODUCT_COLORS.month}
              strokeWidth={1.5}
              strokeDasharray="2 2"
              dot={false}
              connectNulls
              name="month"
              hide={hidden.month}
            />
            {selectedZones.length === 1 ? (
              <Line
                type="monotone"
                dataKey="ua"
                stroke={PRODUCT_COLORS.ua}
                strokeWidth={2}
                dot={false}
                connectNulls
                name="ua"
                hide={hidden.ua}
              />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

type OverviewMode = "countries" | "products";

/** Загальний графік: країни (будь-який продукт) або продукти (EU avg + UA) */
export function OverviewChart({ report }: { report: MarketReport }) {
  const [mode, setMode] = useState<OverviewMode>("products");
  const [currency, setCurrency] = useState<Currency>("EUR");
  const [countryProduct, setCountryProduct] = useState<CountryProduct>("spot");
  const rate = useEurUah(report);

  const allIds = useMemo(() => {
    const base = ZONES.map((z) => z.id) as string[];
    if (countryProduct === "spot") return [...base, "UA", "EU"];
    return base;
  }, [countryProduct]);

  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries([...ZONES.map((z) => z.id), "UA", "EU"].map((id) => [id, true])),
  );
  const [hiddenProducts, setHiddenProducts] = useState<Record<string, boolean>>({});
  const toggleProduct = (key: string) =>
    setHiddenProducts((prev) => ({ ...prev, [key]: !prev[key] }));

  const uaByDate = useMemo(() => {
    const m = new Map<string, { ua: number | null; eu: number | null }>();
    for (const row of report.euUa ?? []) m.set(row.date, { ua: row.uaRdnEur, eu: row.euAvg });
    return m;
  }, [report.euUa]);

  const countryData = report.dates.map((date) => {
    const row: Record<string, string | number | null> = {
      date: formatDateWithWeek(date),
      dayLabel: date.slice(8, 10),
      raw: date,
    };
    for (const z of ZONES) {
      row[z.id] = convert(cellProduct(report.rows[date]?.[z.id], countryProduct), currency, rate);
    }
    const euUa = uaByDate.get(date);
    if (countryProduct === "spot") {
      row.UA = convert(euUa?.ua ?? null, currency, rate);
      row.EU = convert(euUa?.eu ?? null, currency, rate);
    } else {
      row.UA = null;
      row.EU = null;
    }
    return row;
  });

  const productData = report.dates.map((date) => {
    const dayVals: number[] = [];
    const weekVals: number[] = [];
    const monthVals: number[] = [];
    for (const z of ZONES) {
      const c = report.rows[date]?.[z.id];
      if (!c) continue;
      if (c.dayFutures != null) dayVals.push(c.dayFutures);
      const w = meanOf([c.weekFutures, c.weekendFutures]);
      if (w != null) weekVals.push(w);
      if (c.monthFutures != null) monthVals.push(c.monthFutures);
    }
    const euUa = uaByDate.get(date);
    const avg = (xs: number[]) =>
      xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null;
    return {
      date: formatDateWithWeek(date),
      dayLabel: date.slice(8, 10),
      raw: date,
      spot: convert(euUa?.eu ?? null, currency, rate),
      day: convert(avg(dayVals), currency, rate),
      week: convert(avg(weekVals), currency, rate),
      month: convert(avg(monthVals), currency, rate),
      ua: convert(euUa?.ua ?? null, currency, rate),
    };
  });

  const data = mode === "countries" ? countryData : productData;
  const productKeys = ["spot", "day", "week", "month", "ua"];
  const domain =
    mode === "countries"
      ? yDomain(countryData, allIds.filter((id) => enabled[id]))
      : yDomain(productData, productKeys);
  const unit = unitLabel(currency);

  function setAll(on: boolean) {
    setEnabled(Object.fromEntries(allIds.map((id) => [id, on])));
  }

  const productLabel =
    countryProduct === "spot"
      ? "Spot"
      : countryProduct === "day"
        ? "Day-ф’ючерсом"
        : countryProduct === "week"
          ? "Week+Weekend"
          : "Month-ф’ючерсом";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-full border border-border p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setMode("products")}
            className={cn(
              "rounded-full px-3 py-1 font-medium transition-colors",
              mode === "products" ? "bg-foreground text-background" : "text-muted-foreground",
            )}
          >
            Продукти
          </button>
          <button
            type="button"
            onClick={() => setMode("countries")}
            className={cn(
              "rounded-full px-3 py-1 font-medium transition-colors",
              mode === "countries" ? "bg-foreground text-background" : "text-muted-foreground",
            )}
          >
            Країни
          </button>
        </div>
        <CurrencyToggle currency={currency} onChange={setCurrency} rate={rate} />
      </div>

      {mode === "countries" ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Продукт
            </span>
            {(
              [
                ["spot", "Spot"],
                ["day", "Day"],
                ["week", "Week+WE"],
                ["month", "Month"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setCountryProduct(id)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  countryProduct === id
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
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
          <p className="text-xs text-muted-foreground">
            Порівняння країн за {productLabel}. Увімкніть/вимкніть зони чіпами вище.
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Середні по EU: Spot · Day · Week+Weekend · Month, плюс UA РДН.
        </p>
      )}

      <div className="h-[300px] w-full sm:h-[380px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
            <CartesianGrid
              stroke="color-mix(in oklab, var(--color-foreground) 8%, transparent)"
              vertical={false}
            />
            <XAxis
              dataKey="dayLabel"
              tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              interval={0}
              minTickGap={6}
              height={28}
            />
            <YAxis
              domain={domain}
              tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={52}
              tickFormatter={(v) => (typeof v === "number" ? String(Math.round(v)) : String(v))}
            />
            <Tooltip
              contentStyle={{
                background: "var(--color-card)",
                border: "1px solid var(--color-border)",
                borderRadius: 12,
                color: "var(--color-foreground)",
                fontSize: 12,
              }}
              labelFormatter={(_label, payload) => {
                const raw = payload?.[0]?.payload?.raw as string | undefined;
                if (raw) return `${raw} · W${String(isoWeekNumber(raw)).padStart(2, "0")}`;
                return String(_label);
              }}
              formatter={(value, name) => {
                const n = typeof value === "number" ? value.toFixed(2) : "—";
                const labels: Record<string, string> = {
                  spot: "Spot EU",
                  day: "Day EU",
                  week: "Week+WE EU",
                  month: "Month EU",
                  ua: "UA РДН",
                };
                const label =
                  mode === "products" ? (labels[String(name)] ?? String(name)) : String(name);
                return [`${n} ${unit}`, label];
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, color: "var(--color-muted-foreground)" }}
              onClick={(e) => {
                if (mode === "products") toggleProduct(String(e.dataKey));
              }}
              formatter={(value, entry) => {
                if (mode === "products") {
                  const label =
                    (
                      {
                        spot: "Spot EU",
                        day: "Day",
                        week: "Week+WE",
                        month: "Month",
                        ua: "UA РДН",
                      } as Record<string, string>
                    )[value] ?? value;
                  const key = String((entry as { dataKey?: string })?.dataKey ?? value);
                  const isHidden = hiddenProducts[key];
                  return (
                    <span
                      style={{
                        cursor: "pointer",
                        opacity: isHidden ? 0.4 : 1,
                        textDecoration: isHidden ? "line-through" : "none",
                      }}
                    >
                      {label}
                    </span>
                  );
                }
                return value;
              }}
            />
            {mode === "countries"
              ? allIds.map((id) =>
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
                )
              : [
                  <Line
                    key="spot"
                    type="monotone"
                    dataKey="spot"
                    stroke={PRODUCT_COLORS.spot}
                    strokeWidth={2.5}
                    strokeDasharray="4 3"
                    dot={false}
                    connectNulls
                    name="spot"
                    hide={hiddenProducts.spot}
                  />,
                  <Line
                    key="day"
                    type="monotone"
                    dataKey="day"
                    stroke={PRODUCT_COLORS.day}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                    name="day"
                    hide={hiddenProducts.day}
                  />,
                  <Line
                    key="week"
                    type="monotone"
                    dataKey="week"
                    stroke={PRODUCT_COLORS.week}
                    strokeWidth={2}
                    strokeDasharray="3 2"
                    dot={false}
                    connectNulls
                    name="week"
                    hide={hiddenProducts.week}
                  />,
                  <Line
                    key="month"
                    type="monotone"
                    dataKey="month"
                    stroke={PRODUCT_COLORS.month}
                    strokeWidth={2}
                    strokeDasharray="2 2"
                    dot={false}
                    connectNulls
                    name="month"
                    hide={hiddenProducts.month}
                  />,
                  <Line
                    key="ua"
                    type="monotone"
                    dataKey="ua"
                    stroke={PRODUCT_COLORS.ua}
                    strokeWidth={2.5}
                    dot={false}
                    connectNulls
                    name="ua"
                    hide={hiddenProducts.ua}
                  />,
                ]}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {report.decades?.length ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="border-b border-border bg-muted/30 text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Декада</th>
                <th className="px-3 py-2 font-medium">EU Spot</th>
                <th className="px-3 py-2 font-medium">−30%</th>
                <th className="px-3 py-2 font-medium">−20%</th>
                <th className="px-3 py-2 font-medium">−10%</th>
                <th className="px-3 py-2 font-medium">UA Δ%</th>
              </tr>
            </thead>
            <tbody>
              {report.decades.map((d) => {
                const eu =
                  currency === "EUR" ? d.euAvgEur : d.euAvgEur != null ? d.euAvgEur * rate : null;
                const d30 =
                  currency === "EUR" ? d.disc30Eur : d.disc30Uah != null ? d.disc30Uah : null;
                const d20 =
                  currency === "EUR" ? d.disc20Eur : d.disc20Uah != null ? d.disc20Uah : null;
                const d10 =
                  currency === "EUR" ? d.disc10Eur : d.disc10Uah != null ? d.disc10Uah : null;
                const decadeUa = (report.euUa ?? []).filter(
                  (x) => x.date >= d.periodStart && x.date <= d.periodEnd && x.deltaPct != null,
                );
                const uaDelta =
                  decadeUa.length > 0
                    ? Math.round(
                        (decadeUa.reduce((a, x) => a + (x.deltaPct ?? 0), 0) / decadeUa.length) *
                          100,
                      ) / 100
                    : null;
                const fmt = (v: number | null) =>
                  v == null ? "—" : `${v.toFixed(1)} ${currency === "EUR" ? "€" : "₴"}`;
                return (
                  <tr key={d.label} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-2 font-medium">{d.label}</td>
                    <td className="px-3 py-2 tabular-nums">{fmt(eu)}</td>
                    <td className="px-3 py-2 tabular-nums text-emerald-400/90">{fmt(d30)}</td>
                    <td className="px-3 py-2 tabular-nums text-emerald-400/80">{fmt(d20)}</td>
                    <td className="px-3 py-2 tabular-nums text-emerald-400/70">{fmt(d10)}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {uaDelta == null ? "—" : `${uaDelta > 0 ? "+" : ""}${uaDelta.toFixed(1)}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
