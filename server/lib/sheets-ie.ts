/**
 * Live Import/Export from Google Spreadsheet
 * https://docs.google.com/spreadsheets/d/1ysiUAD-ZbN7EZa-pzRciuzOh82tIIB_xNH21xS03FBA
 */
const SPREADSHEET_ID = "1ysiUAD-ZbN7EZa-pzRciuzOh82tIIB_xNH21xS03FBA";

/** Direction sheet → gid */
export const DIR_GIDS: Record<string, string> = {
  "RO-UA": "859566638",
  "MD-UA": "969792147",
  "UA-PL": "675531472",
  "UA-RO": "869465484",
  "UA-MD": "1510170134",
  "SK-UA": "1227330641",
  "UA-SK": "1543199022",
  "HU-UA": "1296612312",
  "UA-HU": "1689598728",
};

const DIR_ORDER = Object.keys(DIR_GIDS);
const IMPORT_DIRS = new Set(["RO-UA", "MD-UA", "SK-UA", "HU-UA", "PL-UA"]);

export type HourRec = {
  date: string;
  hour: number;
  direction: string;
  price: number | null;
  oc: number | null;
  rps: number | null;
  request: number | null;
  cov: number | null;
  winners: Array<{ company: string; volume: number }>;
};

type Cache = {
  at: number;
  byDir: Record<string, HourRec[]>;
  allDates: string[];
};

let cache: Cache | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

function isImport(d: string) {
  return IMPORT_DIRS.has(d) || (d.endsWith("-UA") && !d.startsWith("UA-"));
}

function parseDate(v: string | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  for (const fmt of [
    /^(\d{2})\.(\d{2})\.(\d{4})$/,
    /^(\d{2})\/(\d{2})\/(\d{4})$/,
    /^(\d{4})-(\d{2})-(\d{2})$/,
  ]) {
    const m = s.match(fmt);
    if (!m) continue;
    if (fmt.source.startsWith("^(\\d{4})")) return `${m[1]}-${m[2]}-${m[3]}`;
    return `${m[3]}-${m[2]}-${m[1]}`;
  }
  return null;
}

function parseHour(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  const range = s.match(/^(\d{1,2})\s*:/);
  if (range) {
    const h = parseInt(range[1], 10);
    return h < 24 ? h + 1 : 24;
  }
  const n = parseFloat(s.replace(",", "."));
  if (Number.isNaN(n)) return null;
  const h = Math.round(n);
  if (h >= 1 && h <= 24) return h;
  if (h >= 0 && h <= 23) return h + 1;
  return null;
}

function toFloat(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const s = String(v).replace(/\s/g, "").replace(",", ".").replace(/[^\d.\-]/g, "");
  if (!s || s === "-") return null;
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}

/** Minimal CSV parse (handles quoted fields) */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      row.push(cur);
      cur = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += c;
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

function detectLayout(rows: string[][]) {
  let headerIdx = 0;
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const joined = rows[i].join(" ").toLowerCase();
    if (
      joined.includes("дата") ||
      joined.includes("date") ||
      joined.includes("година") ||
      joined.includes("timetable") ||
      joined.includes("offered")
    ) {
      headerIdx = i;
      break;
    }
  }
  const headers = rows[headerIdx].map((h) => (h || "").trim());
  const hl = headers.map((h) => h.toLowerCase());
  const col: Record<string, number> = {};
  for (let j = 0; j < hl.length; j++) {
    const h = hl[j];
    if (h === "дата" || h === "date" || h.startsWith("date")) col.date ??= j;
    else if (h === "година" || h === "timetable" || h === "hour" || h.includes("timetable"))
      col.hour ??= j;
    else if (h.includes("граничн") || h.includes("price") || h.includes("eur")) col.price ??= j;
    else if (h === "oc [мвт]" || h === "ос [мвт]" || h === "oc" || h.includes("offered capacity"))
      col.oc ??= j;
    else if (h.startsWith("рпс") && h.includes("мвт")) col.rps ??= j;
    else if (h.includes("allocated capacity")) col.rps ??= j;
    else if (h.includes("requested capacity") || h.includes("запит потужності")) col.request ??= j;
  }
  const companyCols: Record<number, string> = {};
  for (let j = 0; j < headers.length; j++) {
    const h = headers[j];
    if (!h) continue;
    const low = h.toLowerCase();
    if (Object.values(col).includes(j)) continue;
    if (
      ["дата", "date", "година", "timetable", "price", "offered", "requested", "allocated"].some(
        (x) => low.includes(x),
      ) ||
      low.includes("ос [") ||
      low.includes("oc [") ||
      low.includes("рпс") ||
      low.includes("запит") ||
      low.includes("учасник") ||
      low.includes("граничн") ||
      low.includes("capacity") ||
      low.includes("мвт")
    )
      continue;
    if (j >= 7 || (col.rps != null && j > col.rps)) companyCols[j] = h;
  }
  const sub = rows[headerIdx + 1] || [];
  const dataStart =
    sub.some((c) => String(c).toLowerCase().includes("рпс")) ? headerIdx + 2 : headerIdx + 1;
  return { col, companyCols, dataStart };
}

function parseSheet(direction: string, csvText: string): HourRec[] {
  const rows = parseCsv(csvText);
  if (rows.length < 2) return [];
  const { col, companyCols, dataStart } = detectLayout(rows);
  const out: HourRec[] = [];
  let lastDate: string | null = null;
  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.length) continue;
    if (col.date != null) {
      const d = parseDate(row[col.date]);
      if (d) lastDate = d;
    }
    if (!lastDate) continue;
    const hour = col.hour != null ? parseHour(row[col.hour]) : null;
    if (hour == null) continue;
    const oc = col.oc != null ? toFloat(row[col.oc]) : null;
    const rps = col.rps != null ? toFloat(row[col.rps]) : null;
    const price = col.price != null ? toFloat(row[col.price]) : null;
    const request = col.request != null ? toFloat(row[col.request]) : null;
    const winners: Array<{ company: string; volume: number }> = [];
    for (const [js, company] of Object.entries(companyCols)) {
      const vol = toFloat(row[Number(js)]);
      if (vol != null && vol !== 0) winners.push({ company, volume: vol });
    }
    const cov = oc && oc > 0 && rps != null ? Math.round((rps / oc) * 10000) / 100 : null;
    out.push({
      date: lastDate,
      hour,
      direction,
      price,
      oc,
      rps,
      request,
      cov,
      winners,
    });
  }
  return out;
}

async function fetchCsv(gid: string): Promise<string> {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${gid}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "GridDelta/1.0" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Sheets gid=${gid} HTTP ${res.status}`);
  return await res.text();
}

export async function loadAllDirections(force = false): Promise<Cache> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache;
  const byDir: Record<string, HourRec[]> = {};
  const dateSet = new Set<string>();
  await Promise.all(
    Object.entries(DIR_GIDS).map(async ([dir, gid]) => {
      try {
        const csv = await fetchCsv(gid);
        const recs = parseSheet(dir, csv);
        byDir[dir] = recs;
        recs.forEach((r) => dateSet.add(r.date));
      } catch (e) {
        console.error(`[ie] failed ${dir}:`, e);
        byDir[dir] = [];
      }
    }),
  );
  const allDates = [...dateSet].sort();
  cache = { at: Date.now(), byDir, allDates };
  return cache;
}

function daySum(recs: HourRec[], day: string, field: "oc" | "rps"): number {
  return recs.filter((r) => r.date === day).reduce((s, r) => s + (r[field] ?? 0), 0);
}

function dayHours(recs: HourRec[], day: string, direction: string) {
  const byH: Record<number, HourRec> = {};
  for (const r of recs) {
    if (r.date === day) byH[r.hour] = r;
  }
  const out = [];
  for (let h = 1; h <= 24; h++) {
    const r = byH[h];
    out.push(
      r
        ? {
            hour: h,
            direction,
            price: r.price,
            oc: r.oc,
            rps: r.rps,
            cov: r.cov,
            winners: r.winners,
          }
        : {
            hour: h,
            direction,
            price: null,
            oc: null,
            rps: null,
            cov: null,
            winners: [] as Array<{ company: string; volume: number }>,
          },
    );
  }
  return out;
}

function delta(a: number, b: number) {
  const abs = Math.round((b - a) * 100) / 100;
  const pct = a ? Math.round(((b - a) / a) * 1000) / 10 : b ? 100 : 0;
  return { abs, pct };
}

export async function buildSnapshot(d1?: string, d2?: string) {
  const { byDir, allDates, at } = await loadAllDirections();
  if (allDates.length < 1) {
    return {
      error: "Немає дат у таблиці",
      meta: { directions: DIR_ORDER, available_dates: [] },
    };
  }
  const day2 = d2 && allDates.includes(d2) ? d2 : allDates[allDates.length - 1];
  let day1 = d1 && allDates.includes(d1) ? d1 : null;
  if (!day1) {
    const idx = allDates.indexOf(day2);
    day1 = idx > 0 ? allDates[idx - 1] : day2;
  }

  const directions = DIR_ORDER.filter((d) => byDir[d]?.length);
  const compare: Record<string, unknown> = {};
  const hourly: { d1: Record<string, unknown>; d2: Record<string, unknown> } = {
    d1: {},
    d2: {},
  };
  const winnersAgg: Record<string, { v1: number; v2: number }> = {};

  for (const d of DIR_ORDER) {
    const recs = byDir[d] || [];
    const oc1 = daySum(recs, day1, "oc");
    const oc2 = daySum(recs, day2, "oc");
    const rps1 = daySum(recs, day1, "rps");
    const rps2 = daySum(recs, day2, "rps");
    const prices1 = recs.filter((r) => r.date === day1 && r.price != null).map((r) => r.price!);
    const prices2 = recs.filter((r) => r.date === day2 && r.price != null).map((r) => r.price!);
    const avg = (arr: number[]) =>
      arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100 : null;
    compare[d] = {
      oc1,
      oc2,
      oc_d: delta(oc1, oc2),
      rps1,
      rps2,
      rps_d: delta(rps1, rps2),
      price1: avg(prices1),
      price2: avg(prices2),
      cov1: oc1 ? Math.round((rps1 / oc1) * 10000) / 100 : null,
      cov2: oc2 ? Math.round((rps2 / oc2) * 10000) / 100 : null,
      side: isImport(d) ? "import" : "export",
    };
    const h1 = dayHours(recs, day1, d);
    const h2 = dayHours(recs, day2, d);
    if (h1.some((x) => x.oc != null || x.rps != null)) hourly.d1[d] = h1;
    if (h2.some((x) => x.oc != null || x.rps != null)) hourly.d2[d] = h2;
    for (const r of recs) {
      if (r.date !== day1 && r.date !== day2) continue;
      for (const w of r.winners) {
        if (!winnersAgg[w.company]) winnersAgg[w.company] = { v1: 0, v2: 0 };
        if (r.date === day1) winnersAgg[w.company].v1 += w.volume;
        else winnersAgg[w.company].v2 += w.volume;
      }
    }
  }

  const winners_cmp = Object.entries(winnersAgg)
    .map(([company, v]) => {
      const v1 = Math.round(v.v1 * 10) / 10;
      const v2 = Math.round(v.v2 * 10) / 10;
      return {
        company,
        v1,
        v2,
        d: delta(v1, v2),
      };
    })
    .sort((a, b) => Math.abs(b.d.abs) - Math.abs(a.d.abs));

  // day_totals: last ~92 calendar dates up to day2 (для порівняння місяців)
  const endIdx = allDates.indexOf(day2);
  const startIdx = Math.max(0, endIdx - 91);
  const window = allDates.slice(startIdx, endIdx + 1);
  const day_totals = [];
  let prev: Record<string, number> | null = null;
  for (const day of window) {
    const row: Record<string, unknown> = {
      date: day,
      oc: 0,
      rps: 0,
      imp_oc: 0,
      exp_oc: 0,
      imp_rps: 0,
      exp_rps: 0,
      directions: {} as Record<string, unknown>,
    };
    for (const d of DIR_ORDER) {
      const recs = byDir[d] || [];
      const oc = daySum(recs, day, "oc");
      const rps = daySum(recs, day, "rps");
      (row.directions as Record<string, unknown>)[d] = {
        oc,
        rps,
        coverage: oc ? Math.round((rps / oc) * 10000) / 100 : null,
      };
      (row as { oc: number }).oc += oc;
      (row as { rps: number }).rps += rps;
      if (isImport(d)) {
        (row as { imp_oc: number }).imp_oc += oc;
        (row as { imp_rps: number }).imp_rps += rps;
      } else {
        (row as { exp_oc: number }).exp_oc += oc;
        (row as { exp_rps: number }).exp_rps += rps;
      }
    }
    if (prev) {
      row.doc = Math.round(((row.oc as number) - prev.oc) * 10) / 10;
      row.drps = Math.round(((row.rps as number) - prev.rps) * 10) / 10;
      row.dimp = Math.round(((row.imp_oc as number) - prev.imp_oc) * 10) / 10;
      row.dexp = Math.round(((row.exp_oc as number) - prev.exp_oc) * 10) / 10;
    } else {
      row.doc = row.drps = row.dimp = row.dexp = null;
    }
    day_totals.push(row);
    prev = {
      oc: row.oc as number,
      rps: row.rps as number,
      imp_oc: row.imp_oc as number,
      exp_oc: row.exp_oc as number,
    };
  }

  const flowFor = (day: string) => {
    let imp_oc = 0,
      exp_oc = 0,
      imp_rps = 0,
      exp_rps = 0;
    for (const d of DIR_ORDER) {
      const recs = byDir[d] || [];
      const oc = daySum(recs, day, "oc");
      const rps = daySum(recs, day, "rps");
      if (isImport(d)) {
        imp_oc += oc;
        imp_rps += rps;
      } else {
        exp_oc += oc;
        exp_rps += rps;
      }
    }
    return { imp_oc, exp_oc, imp_rps, exp_rps };
  };
  const f1 = flowFor(day1);
  const f2 = flowFor(day2);

  return {
    meta: {
      d1: day1,
      d2: day2,
      directions: DIR_ORDER,
      range: [allDates[0], allDates[allDates.length - 1]],
      n_days: allDates.length,
      available_dates: allDates,
      source: "google-sheets-live",
      spreadsheet_id: SPREADSHEET_ID,
      fetched_at: new Date(at).toISOString(),
      cache_ttl_sec: CACHE_TTL_MS / 1000,
    },
    flow: {
      d1: f1,
      d2: f2,
      delta: {
        imp_oc: delta(f1.imp_oc, f2.imp_oc),
        exp_oc: delta(f1.exp_oc, f2.exp_oc),
        imp_rps: delta(f1.imp_rps, f2.imp_rps),
        exp_rps: delta(f1.exp_rps, f2.exp_rps),
      },
    },
    compare,
    day_totals,
    hourly,
    winners_cmp,
  };
}
