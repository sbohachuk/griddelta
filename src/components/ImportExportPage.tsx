import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { loadImportExportData } from "@/lib/import-export-data";

type Delta = { abs?: number | null; pct?: number | null };

type DirDay = { oc?: number | null; rps?: number | null; coverage?: number | null };

type DayTotal = {
  date: string;
  oc?: number | null;
  rps?: number | null;
  imp_oc?: number | null;
  exp_oc?: number | null;
  imp_rps?: number | null;
  exp_rps?: number | null;
  directions?: Record<string, DirDay>;
  doc?: number | null;
  drps?: number | null;
  dimp?: number | null;
  dexp?: number | null;
};

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

type HourRow = {
  hour: number;
  direction?: string;
  price?: number | null;
  oc?: number | null;
  rps?: number | null;
  cov?: number | null;
  winners?: Array<{ company: string; volume: number }>;
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
  day_totals?: DayTotal[];
  hourly?: {
    d1?: Record<string, HourRow[]>;
    d2?: Record<string, HourRow[]>;
  };
  winners_cmp?: Array<{
    company: string;
    v1?: number;
    v2?: number;
    vol?: number;
    d?: Delta;
  }>;
};

const DIR_ORDER = [
  "RO-UA",
  "UA-RO",
  "HU-UA",
  "UA-HU",
  "MD-UA",
  "UA-MD",
  "SK-UA",
  "UA-SK",
  "UA-PL",
];

const DIR_COLOR: Record<string, string> = {
  "RO-UA": "#3b82f6",
  "UA-RO": "#60a5fa",
  "MD-UA": "#22c55e",
  "UA-MD": "#4ade80",
  "UA-PL": "#a855f7",
  "SK-UA": "#f59e0b",
  "UA-SK": "#fbbf24",
  "HU-UA": "#ef4444",
  "UA-HU": "#f87171",
};

const DIR_LABEL: Record<string, string> = {
  "RO-UA": "RO→UA",
  "UA-RO": "UA→RO",
  "MD-UA": "MD→UA",
  "UA-MD": "UA→MD",
  "UA-PL": "UA→PL",
  "SK-UA": "SK→UA",
  "UA-SK": "UA→SK",
  "HU-UA": "HU→UA",
  "UA-HU": "UA→HU",
};

const DIR_CHIP: Record<string, [string, string]> = {
  "RO-UA": ["#3b82f6", "RO"],
  "UA-RO": ["#60a5fa", "RO↑"],
  "MD-UA": ["#22c55e", "MD"],
  "UA-MD": ["#4ade80", "MD↑"],
  "UA-PL": ["#a855f7", "PL"],
  "SK-UA": ["#f59e0b", "SK"],
  "UA-SK": ["#fbbf24", "SK↑"],
  "HU-UA": ["#ef4444", "HU"],
  "UA-HU": ["#f87171", "HU↑"],
};

function fmt(n: number | null | undefined, digits = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("uk-UA", { maximumFractionDigits: digits });
}

function isImportDirection(key: string, side?: string) {
  if (side === "import") return true;
  if (side === "export") return false;
  return /^(RO|MD|SK|HU|PL)-UA$/.test(key) || key.endsWith("-UA");
}

function DeltaTag({ abs, pct }: { abs?: number | null; pct?: number | null }) {
  if (abs == null) {
    return (
      <span className="inline-flex items-center rounded-md bg-slate-500/10 px-2 py-0.5 text-xs font-semibold text-slate-500">
        —
      </span>
    );
  }
  const up = abs > 0;
  const flat = abs === 0;
  const cls = flat
    ? "bg-slate-500/10 text-slate-400"
    : up
      ? "bg-emerald-500/10 text-emerald-400"
      : "bg-red-500/10 text-red-400";
  const sign = up ? "↑ +" : flat ? "" : "↓ ";
  return (
    <span className={"inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold " + cls}>
      {sign}
      {fmt(Math.abs(abs))}
      {pct != null && (
        <span className="opacity-75">
          {up ? "+" : ""}
          {pct}%
        </span>
      )}
    </span>
  );
}

function coverageBg(p?: number | null) {
  if (p == null) return "transparent";
  if (p >= 95) return "rgba(34,197,94,.35)";
  if (p >= 80) return "rgba(34,197,94,.2)";
  if (p >= 60) return "rgba(234,179,8,.25)";
  return "rgba(239,68,68,.3)";
}

function Chip({ dir }: { dir: string }) {
  const [color, label] = DIR_CHIP[dir] ?? ["#64748b", dir.slice(0, 2)];
  return (
    <span
      className="inline-flex h-[22px] min-w-[34px] items-center justify-center rounded-md px-1.5 text-[10px] font-bold text-white"
      style={{ background: color }}
    >
      {label}
    </span>
  );
}

export default function ImportExportPage() {
  const [data, setData] = useState<IEData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "hourly" | "daily" | "winners">("overview");
  const [dir, setDir] = useState<string>("");
  const [dateA, setDateA] = useState<string>("");
  const [dateB, setDateB] = useState<string>("");

  useEffect(() => {
    loadImportExportData()
      .then((d) => {
        const ie = d as IEData;
        setData(ie);
        setDir(ie.meta?.directions?.[0] ?? "");
        const days = ie.day_totals ?? [];
        if (days.length >= 2) {
          setDateA(days[days.length - 2].date);
          setDateB(days[days.length - 1].date);
        } else if (days.length === 1) {
          setDateA(days[0].date);
          setDateB(days[0].date);
        }
      })
      .catch((e) => setErr(String(e)));
  }, []);

  const days = data?.day_totals ?? [];
  const dayA = days.find((d) => d.date === dateA);
  const dayB = days.find((d) => d.date === dateB);

  const dirKeysPresent = useMemo(() => {
    const set = new Set<string>();
    days.forEach((d) => Object.keys(d.directions ?? {}).forEach((k) => set.add(k)));
    (data?.meta?.directions ?? []).forEach((k) => set.add(k));
    return DIR_ORDER.filter((k) => set.has(k));
  }, [days, data]);

  const comparisonRows = useMemo(() => {
    if (!dayA && !dayB) return [];
    return dirKeysPresent.map((key) => {
      const a = dayA?.directions?.[key];
      const b = dayB?.directions?.[key];
      if (!a && !b) return { key, missing: true as const };
      const oc1 = a?.oc ?? null;
      const oc2 = b?.oc ?? null;
      const rps1 = a?.rps ?? null;
      const rps2 = b?.rps ?? null;
      const ocAbs = oc1 != null && oc2 != null ? oc2 - oc1 : null;
      const ocPct = ocAbs != null && oc1 ? Math.round((ocAbs / oc1) * 1000) / 10 : null;
      const rpsAbs = rps1 != null && rps2 != null ? rps2 - rps1 : null;
      const rpsPct = rpsAbs != null && rps1 ? Math.round((rpsAbs / rps1) * 1000) / 10 : null;
      const cov = oc2 ? Math.round(((rps2 ?? 0) / oc2) * 1000) / 10 : null;
      const side = data?.compare?.[key]?.side ?? (isImportDirection(key) ? "import" : "export");
      return { key, missing: false as const, oc1, oc2, ocAbs, ocPct, rps1, rps2, rpsAbs, rpsPct, cov, side };
    });
  }, [dayA, dayB, dirKeysPresent, data]);

  const totals = useMemo(() => {
    let oc1 = 0,
      oc2 = 0,
      rps1 = 0,
      rps2 = 0;
    comparisonRows.forEach((r) => {
      if (r.missing) return;
      oc1 += r.oc1 ?? 0;
      oc2 += r.oc2 ?? 0;
      rps1 += r.rps1 ?? 0;
      rps2 += r.rps2 ?? 0;
    });
    return { oc1, oc2, rps1, rps2 };
  }, [comparisonRows]);

  const fa = {
    impOc: dayA?.imp_oc ?? 0,
    expOc: dayA?.exp_oc ?? 0,
    impRps: dayA?.imp_rps ?? 0,
    expRps: dayA?.exp_rps ?? 0,
  };
  const fb = {
    impOc: dayB?.imp_oc ?? 0,
    expOc: dayB?.exp_oc ?? 0,
    impRps: dayB?.imp_rps ?? 0,
    expRps: dayB?.exp_rps ?? 0,
  };
  const flowDelta = (v1: number, v2: number) => ({
    abs: v2 - v1,
    pct: v1 ? Math.round(((v2 - v1) / v1) * 1000) / 10 : null,
  });

  const stackData = useMemo(
    () =>
      days.map((d) => {
        const row: Record<string, number | string> = { date: d.date.slice(5) };
        dirKeysPresent.forEach((k) => {
          row[k] = d.directions?.[k]?.oc ?? 0;
        });
        return row;
      }),
    [days, dirKeysPresent]
  );

  const flowChartData = useMemo(
    () =>
      days.map((d) => ({
        date: d.date.slice(5),
        "Імпорт ОС": d.imp_oc ?? 0,
        "Експорт ОС": d.exp_oc ?? 0,
      })),
    [days]
  );

  const deltaChartData = useMemo(
    () =>
      days.map((d) => ({
        date: d.date.slice(5),
        "Δ Імпорт": d.dimp ?? 0,
        "Δ Експорт": d.dexp ?? 0,
      })),
    [days]
  );

  if (err) {
    return (
      <div className="min-h-dvh bg-[#0b1220] p-8 text-red-400">
        <p className="font-medium">Помилка завантаження даних</p>
        <p className="mt-2 text-sm text-slate-500">{err}</p>
        <a href="/" className="mt-4 inline-block text-sm text-sky-400">
          ← GridDelta
        </a>
      </div>
    );
  }

  if (!data) {
    return <div className="min-h-dvh bg-[#0b1220] p-8 text-slate-400">Завантаження Імпорт / Експорт…</div>;
  }

  const m = data.meta;

  return (
    <div className="min-h-dvh bg-[#0b1220] text-[#e8eef8]">
      <div className="mx-auto max-w-[1320px] px-4 py-4 pb-12 md:px-[18px]">
        {/* Header */}
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-[#243047] bg-[#141c2e] px-4 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-gradient-to-br from-[#3b82f6] to-[#1d4ed8] text-[17px] font-extrabold text-white">
              Δ
            </div>
            <div>
              <div className="text-[17px] font-extrabold">
                GRIDDELTA <span className="text-[13px] font-medium text-[#8b9bb4]">| ІМПОРТ / ЕКСПОРТ</span>
              </div>
              <div className="text-[11px] text-[#8b9bb4]">ОС · РПС · порівняння обраних днів</div>
            </div>
            <a
              href="/"
              className="ml-3 whitespace-nowrap rounded-lg border border-[#243047] px-3 py-1.5 text-xs text-[#93c5fd]"
            >
              ← Futures / Spot
            </a>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-[#8b9bb4]">Період</div>
            <div className="text-sm font-bold">
              {dateA || "—"} → {dateB || "—"}
            </div>
          </div>
        </div>

        {/* Date pickers */}
        <div className="mb-3.5 flex flex-wrap items-end gap-3 rounded-2xl border border-[#243047] bg-[#141c2e] px-4 py-3.5">
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-[#8b9bb4]">День А (базовий)</div>
            <select
              value={dateA}
              onChange={(e) => setDateA(e.target.value)}
              className="rounded-lg border border-[#243047] bg-[#0b1220] px-2.5 py-1.5 text-sm text-[#e8eef8]"
            >
              {days.map((d) => (
                <option key={d.date} value={d.date}>
                  {d.date}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-[#8b9bb4]">День Б (порівняння)</div>
            <select
              value={dateB}
              onChange={(e) => setDateB(e.target.value)}
              className="rounded-lg border border-[#243047] bg-[#0b1220] px-2.5 py-1.5 text-sm text-[#e8eef8]"
            >
              {days.map((d) => (
                <option key={d.date} value={d.date}>
                  {d.date}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => {
              setDateA(dateB);
              setDateB(dateA);
            }}
            className="rounded-lg border border-[#243047] px-3 py-1.5 text-xs text-[#93c5fd] hover:border-[#3b82f6]"
          >
            ⇄ Поміняти
          </button>
          <div className="ml-auto text-[11px] text-[#8b9bb4]">
            Доступні дні беруться з останнього 14-денного знімку
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-3.5 flex flex-wrap gap-1">
          {(
            [
              ["overview", "Огляд + Δ дня"],
              ["hourly", "Погодинка Δ"],
              ["daily", "14 днів"],
              ["winners", "Контрагенти Δ"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={
                "rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-colors " +
                (tab === id ? "bg-[#1e3a5f] text-[#93c5fd]" : "text-[#8b9bb4] hover:bg-white/5 hover:text-[#e8eef8]")
              }
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "overview" && (
          <div className="space-y-3.5">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-[#3b82f680] bg-gradient-to-br from-[#2563eb1f] to-transparent px-4 py-3.5">
                <div className="mb-2 text-[11px] font-bold text-[#60a5fa]">↓ ІМПОРТ В УКРАЇНУ</div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <div className="text-[10px] text-[#8b9bb4]">ОС (заявлено)</div>
                    <div className="text-xl font-extrabold">
                      {fmt(fb.impOc)} <span className="text-[11px] font-medium text-[#8b9bb4]">МВт</span>
                    </div>
                    <div className="my-0.5 text-[11px] text-[#8b9bb4]">було {fmt(fa.impOc)}</div>
                    <DeltaTag {...flowDelta(fa.impOc, fb.impOc)} />
                  </div>
                  <div>
                    <div className="text-[10px] text-[#8b9bb4]">РПС (акцепт)</div>
                    <div className="text-xl font-extrabold">
                      {fmt(fb.impRps)} <span className="text-[11px] font-medium text-[#8b9bb4]">МВт</span>
                    </div>
                    <div className="my-0.5 text-[11px] text-[#8b9bb4]">було {fmt(fa.impRps)}</div>
                    <DeltaTag {...flowDelta(fa.impRps, fb.impRps)} />
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-[#22c55e4d] bg-gradient-to-br from-[#22c55e1a] to-transparent px-4 py-3.5">
                <div className="mb-2 text-[11px] font-bold text-[#4ade80]">↑ ЕКСПОРТ З УКРАЇНИ</div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <div className="text-[10px] text-[#8b9bb4]">ОС (заявлено)</div>
                    <div className="text-xl font-extrabold">
                      {fmt(fb.expOc)} <span className="text-[11px] font-medium text-[#8b9bb4]">МВт</span>
                    </div>
                    <div className="my-0.5 text-[11px] text-[#8b9bb4]">було {fmt(fa.expOc)}</div>
                    <DeltaTag {...flowDelta(fa.expOc, fb.expOc)} />
                  </div>
                  <div>
                    <div className="text-[10px] text-[#8b9bb4]">РПС (акцепт)</div>
                    <div className="text-xl font-extrabold">
                      {fmt(fb.expRps)} <span className="text-[11px] font-medium text-[#8b9bb4]">МВт</span>
                    </div>
                    <div className="my-0.5 text-[11px] text-[#8b9bb4]">було {fmt(fa.expRps)}</div>
                    <DeltaTag {...flowDelta(fa.expRps, fb.expRps)} />
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <div className="rounded-xl border border-[#243047] bg-[#141c2e] p-3">
                <div className="text-[10px] text-[#8b9bb4]">Σ ОС день Б</div>
                <div className="text-lg font-extrabold">{fmt(totals.oc2)}</div>
              </div>
              <div className="rounded-xl border border-[#243047] bg-[#141c2e] p-3">
                <div className="text-[10px] text-[#8b9bb4]">Σ РПС день Б</div>
                <div className="text-lg font-extrabold">{fmt(totals.rps2)}</div>
              </div>
              <div className="rounded-xl border border-[#243047] bg-[#141c2e] p-3">
                <div className="text-[10px] text-[#8b9bb4]">Δ Імпорт ОС</div>
                <div className="mt-1">
                  <DeltaTag {...flowDelta(fa.impOc, fb.impOc)} />
                </div>
              </div>
              <div className="rounded-xl border border-[#243047] bg-[#141c2e] p-3">
                <div className="text-[10px] text-[#8b9bb4]">Δ Експорт ОС</div>
                <div className="mt-1">
                  <DeltaTag {...flowDelta(fa.expOc, fb.expOc)} />
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-[#243047] bg-[#141c2e] px-4 py-3.5">
              <h2 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-[#8b9bb4]">
                НАПРЯМКИ · ОС / РПС · Δ (день А → день Б) [МВт]
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-[#243047] text-left text-[10px] uppercase tracking-wider text-[#8b9bb4]">
                      <th className="px-1.5 py-2 font-semibold">Напрямок</th>
                      <th className="px-1.5 py-2 font-semibold">Тип</th>
                      <th className="px-1.5 py-2 text-right font-semibold">ОС {dateA || "А"}</th>
                      <th className="px-1.5 py-2 text-right font-semibold">ОС {dateB || "Б"}</th>
                      <th className="px-1.5 py-2 text-center font-semibold">Δ ОС</th>
                      <th className="px-1.5 py-2 text-right font-semibold">РПС {dateA || "А"}</th>
                      <th className="px-1.5 py-2 text-right font-semibold">РПС {dateB || "Б"}</th>
                      <th className="px-1.5 py-2 text-center font-semibold">Δ РПС</th>
                      <th className="px-1.5 py-2 text-right font-semibold">Покриття</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonRows.map((r) =>
                      r.missing ? (
                        <tr key={r.key} className="opacity-40">
                          <td className="px-1.5 py-2">
                            <Chip dir={r.key} />
                            <b className="ml-1.5">{DIR_LABEL[r.key] ?? r.key}</b>
                          </td>
                          <td colSpan={7} className="px-1.5 py-2 text-center text-[11px] text-[#8b9bb4]">
                            немає в кеші
                          </td>
                        </tr>
                      ) : (
                        <tr key={r.key} className="border-b border-[#24304799] hover:bg-white/[0.02]">
                          <td className="px-1.5 py-2">
                            <Chip dir={r.key} />
                            <b className="ml-1.5">{DIR_LABEL[r.key] ?? r.key}</b>
                          </td>
                          <td className="px-1.5 py-2">
                            {r.side === "import" ? (
                              <span className="text-[10px] font-bold text-[#60a5fa]">ІМПОРТ</span>
                            ) : (
                              <span className="text-[10px] font-bold text-[#4ade80]">ЕКСПОРТ</span>
                            )}
                          </td>
                          <td className="px-1.5 py-2 text-right font-semibold tabular-nums">{fmt(r.oc1)}</td>
                          <td className="px-1.5 py-2 text-right font-semibold tabular-nums">{fmt(r.oc2)}</td>
                          <td className="px-1.5 py-2 text-center">
                            <DeltaTag abs={r.ocAbs} pct={r.ocPct} />
                          </td>
                          <td className="px-1.5 py-2 text-right font-semibold tabular-nums">{fmt(r.rps1)}</td>
                          <td className="px-1.5 py-2 text-right font-semibold tabular-nums">{fmt(r.rps2)}</td>
                          <td className="px-1.5 py-2 text-center">
                            <DeltaTag abs={r.rpsAbs} pct={r.rpsPct} />
                          </td>
                          <td className="px-1.5 py-2 text-right">
                            <span
                              className="inline-block min-w-[40px] rounded-md px-1.5 py-1 text-center text-[11px] font-semibold"
                              style={{ background: coverageBg(r.cov) }}
                            >
                              {r.cov != null ? r.cov + "%" : "—"}
                            </span>
                          </td>
                        </tr>
                      )
                    )}
                    <tr className="bg-white/[0.03] font-bold">
                      <td colSpan={2} className="px-1.5 py-2">
                        РАЗОМ
                      </td>
                      <td className="px-1.5 py-2 text-right tabular-nums">{fmt(totals.oc1)}</td>
                      <td className="px-1.5 py-2 text-right tabular-nums">{fmt(totals.oc2)}</td>
                      <td className="px-1.5 py-2 text-center">
                        <DeltaTag
                          abs={totals.oc2 - totals.oc1}
                          pct={totals.oc1 ? Math.round(((totals.oc2 - totals.oc1) / totals.oc1) * 1000) / 10 : null}
                        />
                      </td>
                      <td className="px-1.5 py-2 text-right tabular-nums">{fmt(totals.rps1)}</td>
                      <td className="px-1.5 py-2 text-right tabular-nums">{fmt(totals.rps2)}</td>
                      <td className="px-1.5 py-2 text-center">
                        <DeltaTag
                          abs={totals.rps2 - totals.rps1}
                          pct={totals.rps1 ? Math.round(((totals.rps2 - totals.rps1) / totals.rps1) * 1000) / 10 : null}
                        />
                      </td>
                      <td className="px-1.5 py-2 text-right">
                        <span
                          className="inline-block min-w-[40px] rounded-md px-1.5 py-1 text-center text-[11px] font-semibold"
                          style={{ background: coverageBg(totals.oc2 ? (totals.rps2 / totals.oc2) * 100 : null) }}
                        >
                          {totals.oc2 ? fmt((totals.rps2 / totals.oc2) * 100) + "%" : "—"}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="mt-2 text-[11px] text-[#8b9bb4]">
                <b>ОС</b> — offered · <b>РПС</b> — allocated / отримано · Покриття = РПС/ОС
              </div>
            </div>

            <div className="rounded-2xl border border-[#243047] bg-[#141c2e] px-4 py-3.5">
              <h2 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-[#8b9bb4]">
                ОС ПО НАПРЯМКАХ · {days.length} ДНІВ
              </h2>
              <div style={{ height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stackData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#1a2336" vertical={false} />
                    <XAxis dataKey="date" stroke="#8b9bb4" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#8b9bb4" tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "#141c2e", border: "1px solid #243047", fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {dirKeysPresent.map((k) => (
                      <Bar key={k} dataKey={k} name={DIR_LABEL[k] ?? k} stackId="oc" fill={DIR_COLOR[k] ?? "#64748b"} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-2xl border border-[#243047] bg-[#141c2e] px-4 py-3.5">
              <h2 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-[#8b9bb4]">
                ІМПОРТ vs ЕКСПОРТ · ОС · {days.length} ДНІВ
              </h2>
              <div style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={flowChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#1a2336" vertical={false} />
                    <XAxis dataKey="date" stroke="#8b9bb4" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#8b9bb4" tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "#141c2e", border: "1px solid #243047", fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="Імпорт ОС" stroke="#3b82f6" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="Експорт ОС" stroke="#22c55e" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {tab === "hourly" && (
          <div className="space-y-3.5">
            <div className="rounded-2xl border border-[#243047] bg-[#141c2e] px-4 py-3.5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {(data.meta.directions ?? []).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDir(d)}
                    className={
                      "rounded-full border px-3 py-1 text-xs font-medium " +
                      (dir === d
                        ? "border-[#e8eef8] bg-[#e8eef8] text-[#0b1220]"
                        : "border-[#243047] text-[#8b9bb4] hover:text-[#e8eef8]")
                    }
                  >
                    {DIR_LABEL[d] ?? d}
                  </button>
                ))}
                <div className="ml-auto text-[11px] text-[#8b9bb4]">
                  Погодинний кеш є лише для {m.d1} vs {m.d2}
                </div>
              </div>
              <HourlyTable data={data} direction={dir} />
            </div>
          </div>
        )}

        {tab === "daily" && (
          <div className="space-y-3.5">
            <div className="rounded-2xl border border-[#243047] bg-[#141c2e] px-4 py-3.5">
              <h2 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-[#8b9bb4]">
                ЗВЕДЕНА ТАБЛИЦЯ · ДОБОВІ ОБСЯГИ ОС / РПС [МВт]
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-[#243047] text-left text-[10px] uppercase tracking-wider text-[#8b9bb4]">
                      <th className="px-1.5 py-2 font-semibold">Дата</th>
                      <th className="px-1.5 py-2 text-right font-semibold">Σ ОС</th>
                      <th className="px-1.5 py-2 text-right font-semibold">Σ РПС</th>
                      <th className="px-1.5 py-2 text-center font-semibold">Δ ОС (д−1)</th>
                      <th className="px-1.5 py-2 text-center font-semibold">Δ РПС (д−1)</th>
                      <th className="px-1.5 py-2 text-center font-semibold">Δ Імпорт</th>
                      <th className="px-1.5 py-2 text-center font-semibold">Δ Експорт</th>
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((d) => (
                      <tr
                        key={d.date}
                        className={
                          "border-b border-[#24304799] hover:bg-white/[0.02] " +
                          (d.date === dateA || d.date === dateB ? "bg-[#1e3a5f4d]" : "")
                        }
                      >
                        <td className="px-1.5 py-2 font-medium">{d.date}</td>
                        <td className="px-1.5 py-2 text-right tabular-nums">{fmt(d.oc)}</td>
                        <td className="px-1.5 py-2 text-right tabular-nums">{fmt(d.rps)}</td>
                        <td className="px-1.5 py-2 text-center">
                          <DeltaTag abs={d.doc} pct={null} />
                        </td>
                        <td className="px-1.5 py-2 text-center">
                          <DeltaTag abs={d.drps} pct={null} />
                        </td>
                        <td className="px-1.5 py-2 text-center">
                          <DeltaTag abs={d.dimp} pct={null} />
                        </td>
                        <td className="px-1.5 py-2 text-center">
                          <DeltaTag abs={d.dexp} pct={null} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-2xl border border-[#243047] bg-[#141c2e] px-4 py-3.5">
              <h2 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-[#8b9bb4]">
                HEATMAP · % ПОКРИТТЯ (РПС/ОС)
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-[11.5px]">
                  <thead>
                    <tr className="border-b border-[#243047] text-left text-[10px] uppercase tracking-wider text-[#8b9bb4]">
                      <th className="px-1.5 py-2 font-semibold">Напрямок</th>
                      {days.map((d) => (
                        <th key={d.date} className="px-1.5 py-2 text-center font-semibold">
                          {d.date.slice(5)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dirKeysPresent.map((k) => (
                      <tr key={k} className="border-b border-[#24304799]">
                        <td className="px-1.5 py-2">
                          <Chip dir={k} />
                          <b className="ml-1.5">{DIR_LABEL[k] ?? k}</b>
                        </td>
                        {days.map((d) => {
                          const c = d.directions?.[k]?.coverage;
                          return (
                            <td key={d.date} className="px-1 py-1 text-center">
                              <span
                                className="inline-block min-w-[40px] rounded-md px-1.5 py-1 text-center text-[11px] font-semibold"
                                style={{ background: coverageBg(c) }}
                              >
                                {c != null ? Math.round(c) + "%" : "—"}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-2xl border border-[#243047] bg-[#141c2e] px-4 py-3.5">
              <h2 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-[#8b9bb4]">
                Δ ОС · ІМПОРТ / ЕКСПОРТ ДО ПОПЕРЕДНЬОГО ДНЯ
              </h2>
              <div style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={deltaChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#1a2336" vertical={false} />
                    <XAxis dataKey="date" stroke="#8b9bb4" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#8b9bb4" tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "#141c2e", border: "1px solid #243047", fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Δ Імпорт" fill="rgba(59,130,246,.7)" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Δ Експорт" fill="rgba(34,197,94,.65)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {tab === "winners" && (
          <div className="space-y-3.5">
            <div className="rounded-2xl border border-[#243047] bg-[#141c2e] px-4 py-3.5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-[11px] font-bold uppercase tracking-wider text-[#8b9bb4]">
                  КОНТРАГЕНТИ · ОБСЯГ {m.d2} vs {m.d1} · Δ
                </h2>
                <span className="text-[11px] text-[#8b9bb4]">фіксовано на останню пару днів</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-[#243047] text-left text-[10px] uppercase tracking-wider text-[#8b9bb4]">
                      <th className="px-1.5 py-2 font-semibold">#</th>
                      <th className="px-1.5 py-2 font-semibold">Компанія</th>
                      <th className="px-1.5 py-2 text-right font-semibold">{m.d1}</th>
                      <th className="px-1.5 py-2 text-right font-semibold">{m.d2}</th>
                      <th className="px-1.5 py-2 text-center font-semibold">Δ МВт</th>
                      <th className="px-1.5 py-2 text-center font-semibold">Δ %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.winners_cmp ?? []).map((w, i) => (
                      <tr key={i} className="border-b border-[#24304799] hover:bg-white/[0.02]">
                        <td className="px-1.5 py-2 text-[#8b9bb4]">{i + 1}</td>
                        <td className="px-1.5 py-2 font-semibold">{w.company}</td>
                        <td className="px-1.5 py-2 text-right tabular-nums">{fmt(w.v1, 1)}</td>
                        <td className="px-1.5 py-2 text-right tabular-nums">{fmt(w.v2, 1)}</td>
                        <td className="px-1.5 py-2 text-center">
                          <DeltaTag abs={w.d?.abs} pct={null} />
                        </td>
                        <td className="px-1.5 py-2 text-center">
                          {w.d?.pct != null ? (
                            <DeltaTag abs={w.d.abs} pct={w.d.pct} />
                          ) : (
                            <span className="text-[#8b9bb4]">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {(data.winners_cmp ?? []).length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-1.5 py-6 text-center text-[#8b9bb4]">
                          Немає даних по контрагентах у знімку
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-2xl border border-[#243047] bg-[#141c2e] px-4 py-3.5">
              <h2 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-[#8b9bb4]">
                ТОП ЗРОСТАННЯ / ПАДІННЯ
              </h2>
              <TopMovers winners={data.winners_cmp ?? []} />
            </div>
          </div>
        )}

        <p className="pb-2 pt-6 text-xs text-slate-600">
          Знімок даних з Google Sheets. Live-оновлення з таблиці — наступний етап (API + service account на
          Vercel).
        </p>
      </div>
    </div>
  );
}

function TopMovers({
  winners,
}: {
  winners: Array<{ company: string; d?: Delta }>;
}) {
  const up = [...winners]
    .filter((x) => (x.d?.abs ?? 0) > 0)
    .sort((a, b) => (b.d?.abs ?? 0) - (a.d?.abs ?? 0))
    .slice(0, 8);
  const down = [...winners]
    .filter((x) => (x.d?.abs ?? 0) < 0)
    .sort((a, b) => (a.d?.abs ?? 0) - (b.d?.abs ?? 0))
    .slice(0, 8);
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <div className="mb-2 text-xs font-bold text-[#4ade80]">↑ Зростання</div>
        {up.length === 0 && <div className="text-[#8b9bb4]">—</div>}
        {up.map((x, i) => (
          <div key={i} className="flex items-center justify-between border-b border-[#243047] py-1.5">
            <span className="text-xs">{x.company}</span>
            <DeltaTag abs={x.d?.abs} pct={x.d?.pct} />
          </div>
        ))}
      </div>
      <div>
        <div className="mb-2 text-xs font-bold text-[#f87171]">↓ Зменшення</div>
        {down.length === 0 && <div className="text-[#8b9bb4]">—</div>}
        {down.map((x, i) => (
          <div key={i} className="flex items-center justify-between border-b border-[#243047] py-1.5">
            <span className="text-xs">{x.company}</span>
            <DeltaTag abs={x.d?.abs} pct={x.d?.pct} />
          </div>
        ))}
      </div>
    </div>
  );
}

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

  if (Array.isArray(raw)) {
    for (const row of raw as HourRow[]) {
      const hRaw = row.hour;
      if (hRaw == null) continue;
      let idx = Number(hRaw);
      if (idx >= 1 && idx <= 24) idx = idx - 1;
      if (idx < 0 || idx > 23) continue;
      if (row.oc != null) oc[idx] = Number(row.oc);
      if (row.rps != null) rps[idx] = Number(row.rps);
    }
    return { oc, rps };
  }

  return empty;
}

function HourlyTable({ data, direction }: { data: IEData; direction: string }) {
  const s1 = getHourlySeries(data.hourly, "d1", direction);
  const s2 = getHourlySeries(data.hourly, "d2", direction);
  const hours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div className="overflow-x-auto rounded-xl border border-[#243047]">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="border-b border-[#243047] text-left text-[10px] uppercase tracking-wider text-[#8b9bb4]">
            <th className="px-3 py-2 font-semibold">Година</th>
            <th className="px-3 py-2 text-right font-semibold">ОС {data.meta.d1}</th>
            <th className="px-3 py-2 text-right font-semibold">ОС {data.meta.d2}</th>
            <th className="px-3 py-2 text-center font-semibold">Δ ОС</th>
            <th className="px-3 py-2 text-right font-semibold">РПС {data.meta.d1}</th>
            <th className="px-3 py-2 text-right font-semibold">РПС {data.meta.d2}</th>
            <th className="px-3 py-2 text-center font-semibold">Δ РПС</th>
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
              <tr key={h} className="border-b border-[#24304799]">
                <td className="px-3 py-2 tabular-nums">{String(h + 1).padStart(2, "0")}:00</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(oc1)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(oc2)}</td>
                <td className="px-3 py-2 text-center">
                  <DeltaTag abs={dOc} pct={null} />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(rps1)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(rps2)}</td>
                <td className="px-3 py-2 text-center">
                  <DeltaTag abs={dRps} pct={null} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
