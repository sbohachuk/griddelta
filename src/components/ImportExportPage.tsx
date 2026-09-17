import { useEffect, useMemo, useState } from "react";
import { loadImportExportData } from "@/lib/import-export-data";

type IEData = {
  meta: { d1: string; d2: string; directions: string[] };
  compare?: Record<string, { oc?: number; rps?: number; price?: number; coverage?: number }>;
  hourly?: { d1?: Record<string, number[]>; d2?: Record<string, number[]> };
  winners_cmp?: Array<{ company: string; d: { abs: number; pct: number } }>;
};

function fmt(n: number | null | undefined, digits = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("uk-UA", { maximumFractionDigits: digits });
}

function deltaClass(n: number | null | undefined) {
  if (n == null || n === 0) return "text-slate-500";
  return n > 0 ? "text-emerald-400" : "text-red-400";
}

export default function ImportExportPage() {
  const [data, setData] = useState<IEData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "hourly" | "winners">("overview");
  const [dir, setDir] = useState("");

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

  const totals = useMemo(() => {
    if (!data?.compare) return { imp: 0, exp: 0 };
    let imp = 0;
    let exp = 0;
    for (const [k, v] of Object.entries(data.compare)) {
      const rps = v.rps ?? 0;
      if (k.match(/^(RO|MD|SK|HU|PL)-UA$/)) imp += rps;
      else if (k.startsWith("UA-")) exp += rps;
      else imp += rps;
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
      <div className="min-h-dvh bg-[#0b1220] text-slate-400 p-8">Завантаження Імпорт / Експорт…</div>
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
            <h1 className="mt-1 text-2xl md:text-3xl font-semibold tracking-tight">Імпорт / Експорт</h1>
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
          <Kpi label="Імпорт (РПС)" value={fmt(totals.imp) + " МВт"} hint={`за ${m.d2}`} />
          <Kpi label="Експорт (РПС)" value={fmt(totals.exp) + " МВт"} hint={`за ${m.d2}`} />
          <Kpi label="Нетто" value={fmt(totals.imp - totals.exp) + " МВт"} hint="імпорт − експорт" />
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
                  <th className="px-4 py-3 font-medium text-right">ОС</th>
                  <th className="px-4 py-3 font-medium text-right">РПС</th>
                  <th className="px-4 py-3 font-medium text-right">Ціна</th>
                  <th className="px-4 py-3 font-medium text-right">Покриття</th>
                </tr>
              </thead>
              <tbody>
                {directions.map((d) => {
                  const c = compare[d] ?? {};
                  return (
                    <tr key={d} className="border-b border-slate-800/80 hover:bg-slate-800/40">
                      <td className="px-4 py-2.5 font-medium">{d}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmt(c.oc)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmt(c.rps)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmt(c.price, 2)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {c.coverage != null
                          ? fmt(c.coverage * (c.coverage <= 1 ? 100 : 1), 1) + "%"
                          : "—"}
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
                  <th className="px-4 py-3 font-medium text-right">Δ обсяг</th>
                  <th className="px-4 py-3 font-medium text-right">Δ %</th>
                </tr>
              </thead>
              <tbody>
                {(data.winners_cmp ?? []).slice(0, 40).map((w, i) => (
                  <tr key={i} className="border-b border-slate-800/80">
                    <td className="px-4 py-2.5">{w.company}</td>
                    <td className={"px-4 py-2.5 text-right tabular-nums " + deltaClass(w.d?.abs)}>
                      {fmt(w.d?.abs)}
                    </td>
                    <td className={"px-4 py-2.5 text-right tabular-nums " + deltaClass(w.d?.pct)}>
                      {w.d?.pct != null ? fmt(w.d.pct, 1) + "%" : "—"}
                    </td>
                  </tr>
                ))}
                {(data.winners_cmp ?? []).length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-slate-500 text-center">
                      Немає даних по контрагентах
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-slate-600 pb-8">
          Знімок з Google Sheets (EAP + JAO). Live-оновлення — наступний етап.
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

function HourlyTable({ data, direction }: { data: IEData; direction: string }) {
  const h1 = data.hourly?.d1?.[direction] ?? [];
  const h2 = data.hourly?.d2?.[direction] ?? [];
  const hours = Array.from({ length: 24 }, (_, i) => i);
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-500 border-b border-slate-800">
            <th className="px-4 py-3 font-medium">Година</th>
            <th className="px-4 py-3 font-medium text-right">{data.meta.d1}</th>
            <th className="px-4 py-3 font-medium text-right">{data.meta.d2}</th>
            <th className="px-4 py-3 font-medium text-right">Δ</th>
          </tr>
        </thead>
        <tbody>
          {hours.map((h) => {
            const a = h1[h];
            const b = h2[h];
            const d = a != null && b != null ? b - a : null;
            return (
              <tr key={h} className="border-b border-slate-800/80">
                <td className="px-4 py-2 tabular-nums">{String(h).padStart(2, "0")}:00</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmt(a)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmt(b)}</td>
                <td className={"px-4 py-2 text-right tabular-nums " + deltaClass(d)}>{fmt(d)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
