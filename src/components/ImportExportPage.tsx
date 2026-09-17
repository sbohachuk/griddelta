import { useEffect, useMemo, useState } from "react";
import { loadImportExportData } from "@/lib/import-export-data";

type Delta = { abs?: number | null; pct?: number | null };

type CompareItem = {
  oc1?: number | null;
  oc2?: number | null;
  oc_d?: Delta;
  rps1?: number | null;
  rps2?: number | null;
  rps_d?: Delta;
  price1?: number | null;
  price2?: number | null;
  cov1?: number | null;
  cov2?: number | null;
  side?: "import" | "export" | string;
};

type IEData = {
  meta: {
    d1: string;
    d2: string;
    directions: string[];
    range?: string | string[];
    n_days?: number;
  };
  flow?: {
    d1?: { imp_oc?: number; exp_oc?: number; imp_rps?: number; exp_rps?: number };
    d2?: { imp_oc?: number; exp_oc?: number; imp_rps?: number; exp_rps?: number };
    delta?: Record<string, Delta>;
  };
  compare?: Record<string, CompareItem>;
  day_totals?: Array<{
    date: string;
    oc?: number;
    rps?: number;
    imp_oc?: number;
    exp_oc?: number;
    imp_rps?: number;
    exp_rps?: number;
    directions?: Record<string, { oc?: number; rps?: number; coverage?: number }>;
  }>;
  hourly?: {
    d1?: Record<string, unknown>;
    d2?: Record<string, unknown>;
  };
  winners_cmp?: Array<{
    company: string;
    v1?: number;
    v2?: number;
    vol?: number;
    d?: Delta;
  }>;
};

function fmt(n: number | null | undefined, digits = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("uk-UA", { maximumFractionDigits: digits });
}

function deltaClass(n: number | null | undefined) {
  if (n == null || n === 0) return "text-slate-500";
  return n > 0 ? "text-emerald-400" : "text-red-400";
}

function isImportDirection(key: string, side?: string) {
  if (side === "import") return true;
  if (side === "export") return false;
  return /^(RO|MD|SK|HU|PL)-UA$/.test(key) || key.endsWith("-UA");
}

export default function ImportExportPage() {
  const [data, setData] = useState<IEData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "hourly" | "winners">("overview");
  const [dir, setDir] = useState<string>("");

  useEffect(() => {
    loadImportExportData()
      .then((d) => {
        const ie = d as IEData;
        setData(ie);
        setDir(ie.meta?.directions?.[0] ?? "");
      })
      .catch((e) => setErr(String(e)));
  }, []);

  const directions = data?.meta?.directions ?? [];
  const compare = data?.compare ?? {};

  // KPI: use flow if present, otherwise aggregate from compare (rps2 = current day)
  const totals = useMemo(() => {
    if (data?.flow?.d2) {
      return {
        imp: data.flow.d2.imp_rps ?? 0,
        exp: data.flow.d2.exp_rps ?? 0,
      };
    }
    if (!data?.compare) return { imp: 0, exp: 0 };
    let imp = 0;
    let exp = 0;
    for (const [k, v] of Object.entries(data.compare)) {
      const rps = v.rps2 ?? 0;
      if (isImportDirection(k, v.side)) imp += rps;
      else exp += rps;
    }
    return { imp, exp };
  }, [data]);

  if (err) {
    return (
      <div className="min-h-dvh bg-[#0b1220] text-red-400 p-8">
        <p className="font-medium">Помилка завантаження даних</p>
        <p className="text-sm mt-2 text-slate-500">{err}</p>
        <a href="/" className="text-sm text-sky-400 mt-4 inline-block">
          ← GridDelta
        </a>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-dvh bg-[#0b1220] text-slate-400 p-8">
        Завантаження Імпорт / Експорт…
      </div>
    );
  }

  const m = data.meta;

  return (
    <div className="min-h-dvh bg-[#0b1220] text-slate-100">
      <header className="border-b border-slate-800">
        <div className="mx-auto max-w-6xl px-4 py-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
              Power desk · Cross-border
            </p>
            <h1 className="mt-1 text-2xl md:text-3xl font-semibold tracking-tight">
              Імпорт / Експорт
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              {m.d1} → {m.d2} · {directions.length} напрямків · дані з Google Sheets (EAP + JAO)
            </p>
          </div>
          <a
            href="/"
            className="inline-flex h-9 items-center rounded-full border border-slate-700 px-3.5 text-sm text-slate-400 hover:text-white hover:border-slate-500"
          >
            ← GridDelta
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 space-y-6">
        <section className="grid gap-3 sm:grid-cols-3">
          <Kpi label="Імпорт (РПС)" value={fmt(totals.imp, 0) + " МВт"} hint={`за ${m.d2}`} />
          <Kpi label="Експорт (РПС)" value={fmt(totals.exp, 0) + " МВт"} hint={`за ${m.d2}`} />
          <Kpi
            label="Нетто"
            value={fmt(totals.imp - totals.exp, 0) + " МВт"}
            hint="імпорт − експорт"
          />
        </section>

        <div className="flex flex-wrap gap-2">
          {(
            [
              ["overview", "Огляд Δ"],
              ["hourly", "Погодинка"],
              ["winners", "Контрагенти"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={
                "rounded-full px-4 py-1.5 text-sm font-medium border transition-colors " +
                (tab === id
                  ? "bg-slate-100 text-slate-900 border-slate-100"
                  : "border-slate-700 text-slate-400 hover:text-white")
              }
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "overview" && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-800">
                  <th className="px-4 py-3 font-medium">Напрямок</th>
                  <th className="px-4 py-3 font-medium text-right">ОС {m.d1}</th>
                  <th className="px-4 py-3 font-medium text-right">ОС {m.d2}</th>
                  <th className="px-4 py-3 font-medium text-right">Δ ОС</th>
                  <th className="px-4 py-3 font-medium text-right">РПС {m.d1}</th>
                  <th className="px-4 py-3 font-medium text-right">РПС {m.d2}</th>
                  <th className="px-4 py-3 font-medium text-right">Δ РПС</th>
                  <th className="px-4 py-3 font-medium text-right">Ціна</th>
                  <th className="px-4 py-3 font-medium text-right">Покриття</th>
                </tr>
              </thead>
              <tbody>
                {directions.map((d) => {
                  const c = compare[d] ?? {};
                  const cov =
                    c.cov2 != null
                      ? c.cov2
                      : c.oc2 && c.oc2 > 0 && c.rps2 != null
                        ? (c.rps2 / c.oc2) * 100
                        : null;
                  return (
                    <tr key={d} className="border-b border-slate-800/80 hover:bg-slate-800/40">
                      <td className="px-4 py-2.5 font-medium">
                        {d}
                        {c.side ? (
                          <span className="ml-2 text-[10px] uppercase text-slate-500">
                            {c.side === "import" ? "імп" : "експ"}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmt(c.oc1)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmt(c.oc2)}</td>
                      <td
                        className={
                          "px-4 py-2.5 text-right tabular-nums " + deltaClass(c.oc_d?.abs)
                        }
                      >
                        {fmt(c.oc_d?.abs)}
                        {c.oc_d?.pct != null ? (
                          <span className="text-xs ml-1 opacity-70">
                            ({fmt(c.oc_d.pct, 1)}%)
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmt(c.rps1)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmt(c.rps2)}</td>
                      <td
                        className={
                          "px-4 py-2.5 text-right tabular-nums " + deltaClass(c.rps_d?.abs)
                        }
                      >
                        {fmt(c.rps_d?.abs)}
                        {c.rps_d?.pct != null ? (
                          <span className="text-xs ml-1 opacity-70">
                            ({fmt(c.rps_d.pct, 1)}%)
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {fmt(c.price2, 2)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {cov != null ? fmt(cov, 1) + "%" : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {tab === "hourly" && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {directions.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDir(d)}
                  className={
                    "rounded-full px-3 py-1 text-xs font-medium border " +
                    (dir === d
                      ? "bg-slate-100 text-slate-900 border-slate-100"
                      : "border-slate-700 text-slate-400")
                  }
                >
                  {d}
                </button>
              ))}
            </div>
            <HourlyTable data={data} direction={dir} />
          </div>
        )}

        {tab === "winners" && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-800">
                  <th className="px-4 py-3 font-medium">Контрагент</th>
                  <th className="px-4 py-3 font-medium text-right">Обсяг {m.d1}</th>
                  <th className="px-4 py-3 font-medium text-right">Обсяг {m.d2}</th>
                  <th className="px-4 py-3 font-medium text-right">Δ обсяг</th>
                  <th className="px-4 py-3 font-medium text-right">Δ %</th>
                </tr>
              </thead>
              <tbody>
                {(data.winners_cmp ?? []).slice(0, 40).map((w, i) => (
                  <tr key={i} className="border-b border-slate-800/80">
                    <td className="px-4 py-2.5">{w.company}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmt(w.v1)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmt(w.v2)}</td>
                    <td
                      className={
                        "px-4 py-2.5 text-right tabular-nums " + deltaClass(w.d?.abs)
                      }
                    >
                      {fmt(w.d?.abs, 0)}
                    </td>
                    <td
                      className={
                        "px-4 py-2.5 text-right tabular-nums " + deltaClass(w.d?.pct)
                      }
                    >
                      {w.d?.pct != null ? fmt(w.d.pct, 1) + "%" : "—"}
                    </td>
                  </tr>
                ))}
                {(data.winners_cmp ?? []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-slate-500 text-center">
                      Немає даних по контрагентах у знімку
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-slate-600 pb-8">
          Знімок даних з Google Sheets. Live-оновлення з таблиці — наступний етап (API + service
          account на Vercel).
        </p>
      </main>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-4">
      <p className="text-[11px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

/**
 * Normalize hourly series.
 * Actual snapshot format: array of { hour: 1..24, oc, rps, price, cov, winners }.
 * Also supports legacy number[] or { oc: number[], rps: number[] }.
 */
function getHourlySeries(
  hourly: IEData["hourly"],
  day: "d1" | "d2",
  direction: string
): { oc: Array<number | null>; rps: Array<number | null> } {
  const empty = {
    oc: Array(24).fill(null) as Array<number | null>,
    rps: Array(24).fill(null) as Array<number | null>,
  };
  const raw = hourly?.[day]?.[direction];
  if (!raw) return empty;

  const oc: Array<number | null> = Array(24).fill(null);
  const rps: Array<number | null> = Array(24).fill(null);

  // Primary format: list of hour objects { hour, oc, rps, ... }
  if (Array.isArray(raw)) {
    const first = raw[0];
    if (first != null && typeof first === "object" && !Array.isArray(first)) {
      for (const row of raw as Array<Record<string, unknown>>) {
        const hRaw = row.hour;
        if (hRaw == null) continue;
        // hour in data is 1..24 → index 0..23
        let idx = Number(hRaw);
        if (idx >= 1 && idx <= 24) idx = idx - 1;
        if (idx < 0 || idx > 23) continue;
        if (row.oc != null) oc[idx] = Number(row.oc);
        if (row.rps != null) rps[idx] = Number(row.rps);
      }
      return { oc, rps };
    }
    // Legacy: plain number[] → РПС only, index 0..23
    for (let i = 0; i < 24; i++) {
      const v = (raw as Array<number | null>)[i];
      if (v != null) rps[i] = Number(v);
    }
    return { oc, rps };
  }

  // Object with oc/rps arrays
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.oc) || Array.isArray(obj.rps)) {
    for (let i = 0; i < 24; i++) {
      const a = (obj.oc as Array<number | null>)?.[i];
      const b = (obj.rps as Array<number | null>)?.[i];
      if (a != null) oc[i] = Number(a);
      if (b != null) rps[i] = Number(b);
    }
    return { oc, rps };
  }

  return empty;
}

function HourlyTable({ data, direction }: { data: IEData; direction: string }) {
  const s1 = getHourlySeries(data.hourly, "d1", direction);
  const s2 = getHourlySeries(data.hourly, "d2", direction);
  const hours = Array.from({ length: 24 }, (_, i) => i);

  const hasOc = s1.oc.some((v) => v != null) || s2.oc.some((v) => v != null);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-500 border-b border-slate-800">
            <th className="px-4 py-3 font-medium">Година</th>
            {hasOc && (
              <>
                <th className="px-4 py-3 font-medium text-right">ОС {data.meta.d1}</th>
                <th className="px-4 py-3 font-medium text-right">ОС {data.meta.d2}</th>
                <th className="px-4 py-3 font-medium text-right">Δ ОС</th>
              </>
            )}
            <th className="px-4 py-3 font-medium text-right">РПС {data.meta.d1}</th>
            <th className="px-4 py-3 font-medium text-right">РПС {data.meta.d2}</th>
            <th className="px-4 py-3 font-medium text-right">Δ РПС</th>
          </tr>
        </thead>
        <tbody>
          {hours.map((h) => {
            const oc1 = s1.oc[h];
            const oc2 = s2.oc[h];
            const rps1 = s1.rps[h];
            const rps2 = s2.rps[h];
            const dOc = oc1 != null && oc2 != null ? oc2 - oc1 : null;
            const dRps = rps1 != null && rps2 != null ? rps2 - rps1 : null;
            return (
              <tr key={h} className="border-b border-slate-800/80">
                <td className="px-4 py-2 tabular-nums">{String(h).padStart(2, "0")}:00</td>
                {hasOc && (
                  <>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(oc1)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(oc2)}</td>
                    <td className={"px-4 py-2 text-right tabular-nums " + deltaClass(dOc)}>
                      {fmt(dOc)}
                    </td>
                  </>
                )}
                <td className="px-4 py-2 text-right tabular-nums">{fmt(rps1)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmt(rps2)}</td>
                <td className={"px-4 py-2 text-right tabular-nums " + deltaClass(dRps)}>
                  {fmt(dRps)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
