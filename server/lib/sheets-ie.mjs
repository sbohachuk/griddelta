const SPREADSHEET_ID = "1ysiUAD-ZbN7EZa-pzRciuzOh82tIIB_xNH21xS03FBA";
const DIR_GIDS = {
  "RO-UA": "859566638",
  "MD-UA": "969792147",
  "UA-PL": "675531472",
  "UA-RO": "869465484",
  "UA-MD": "1510170134",
  "SK-UA": "1227330641",
  "UA-SK": "1543199022",
  "HU-UA": "1296612312",
  "UA-HU": "1689598728"
};
const DIR_ORDER = Object.keys(DIR_GIDS);
const IMPORT_DIRS = /* @__PURE__ */ new Set(["RO-UA", "MD-UA", "SK-UA", "HU-UA", "PL-UA"]);
let cache = null;
const CACHE_TTL_MS = 10 * 60 * 1e3;
function isImport(d) {
  return IMPORT_DIRS.has(d) || d.endsWith("-UA") && !d.startsWith("UA-");
}
function parseDate(v) {
  if (!v) return null;
  const s = v.trim();
  for (const fmt of [
    /^(\d{2})\.(\d{2})\.(\d{4})$/,
    /^(\d{2})\/(\d{2})\/(\d{4})$/,
    /^(\d{4})-(\d{2})-(\d{2})$/
  ]) {
    const m = s.match(fmt);
    if (!m) continue;
    if (fmt.source.startsWith("^(\\d{4})")) return `${m[1]}-${m[2]}-${m[3]}`;
    return `${m[3]}-${m[2]}-${m[1]}`;
  }
  return null;
}
function parseHour(v) {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  const range = s.match(/^(\d{1,2})\s*:/);
  if (range) {
    const h2 = parseInt(range[1], 10);
    return h2 < 24 ? h2 + 1 : 24;
  }
  const n = parseFloat(s.replace(",", "."));
  if (Number.isNaN(n)) return null;
  const h = Math.round(n);
  if (h >= 1 && h <= 24) return h;
  if (h >= 0 && h <= 23) return h + 1;
  return null;
}
function toFloat(v) {
  if (v == null || v === "") return null;
  const s = String(v).replace(/\s/g, "").replace(",", ".").replace(/[^\d.\-]/g, "");
  if (!s || s === "-") return null;
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}
function parseCsv(text) {
  const rows = [];
  let row = [];
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
function detectLayout(rows) {
  let headerIdx = 0;
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const joined = rows[i].join(" ").toLowerCase();
    if (joined.includes("\u0434\u0430\u0442\u0430") || joined.includes("date") || joined.includes("\u0433\u043E\u0434\u0438\u043D\u0430") || joined.includes("timetable") || joined.includes("offered")) {
      headerIdx = i;
      break;
    }
  }
  const headers = rows[headerIdx].map((h) => (h || "").trim());
  const hl = headers.map((h) => h.toLowerCase());
  const col = {};
  for (let j = 0; j < hl.length; j++) {
    const h = hl[j];
    if (h === "\u0434\u0430\u0442\u0430" || h === "date" || h.startsWith("date")) col.date ??= j;
    else if (h === "\u0433\u043E\u0434\u0438\u043D\u0430" || h === "timetable" || h === "hour" || h.includes("timetable"))
      col.hour ??= j;
    else if (h.includes("\u0433\u0440\u0430\u043D\u0438\u0447\u043D") || h.includes("price") || h.includes("eur")) col.price ??= j;
    else if (h === "oc [\u043C\u0432\u0442]" || h === "\u043E\u0441 [\u043C\u0432\u0442]" || h === "oc" || h.includes("offered capacity"))
      col.oc ??= j;
    else if (h.startsWith("\u0440\u043F\u0441") && h.includes("\u043C\u0432\u0442")) col.rps ??= j;
    else if (h.includes("allocated capacity")) col.rps ??= j;
    else if (h.includes("requested capacity") || h.includes("\u0437\u0430\u043F\u0438\u0442 \u043F\u043E\u0442\u0443\u0436\u043D\u043E\u0441\u0442\u0456")) col.request ??= j;
  }
  const companyCols = {};
  for (let j = 0; j < headers.length; j++) {
    const h = headers[j];
    if (!h) continue;
    const low = h.toLowerCase();
    if (Object.values(col).includes(j)) continue;
    if (["\u0434\u0430\u0442\u0430", "date", "\u0433\u043E\u0434\u0438\u043D\u0430", "timetable", "price", "offered", "requested", "allocated"].some(
      (x) => low.includes(x)
    ) || low.includes("\u043E\u0441 [") || low.includes("oc [") || low.includes("\u0440\u043F\u0441") || low.includes("\u0437\u0430\u043F\u0438\u0442") || low.includes("\u0443\u0447\u0430\u0441\u043D\u0438\u043A") || low.includes("\u0433\u0440\u0430\u043D\u0438\u0447\u043D") || low.includes("capacity") || low.includes("\u043C\u0432\u0442"))
      continue;
    if (j >= 7 || col.rps != null && j > col.rps) companyCols[j] = h;
  }
  const sub = rows[headerIdx + 1] || [];
  const dataStart = sub.some((c) => String(c).toLowerCase().includes("\u0440\u043F\u0441")) ? headerIdx + 2 : headerIdx + 1;
  return { col, companyCols, dataStart };
}
function parseSheet(direction, csvText) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) return [];
  const { col, companyCols, dataStart } = detectLayout(rows);
  const out = [];
  let lastDate = null;
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
    const winners = [];
    for (const [js, company] of Object.entries(companyCols)) {
      const vol = toFloat(row[Number(js)]);
      if (vol != null && vol !== 0) winners.push({ company, volume: vol });
    }
    const cov = oc && oc > 0 && rps != null ? Math.round(rps / oc * 1e4) / 100 : null;
    out.push({
      date: lastDate,
      hour,
      direction,
      price,
      oc,
      rps,
      request,
      cov,
      winners
    });
  }
  return out;
}
async function fetchCsv(gid) {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${gid}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "GridDelta/1.0" },
    redirect: "follow"
  });
  if (!res.ok) throw new Error(`Sheets gid=${gid} HTTP ${res.status}`);
  return await res.text();
}
async function loadAllDirections(force = false) {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache;
  const byDir = {};
  const dateSet = /* @__PURE__ */ new Set();
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
    })
  );
  const allDates = [...dateSet].sort();
  cache = { at: Date.now(), byDir, allDates };
  return cache;
}
function daySum(recs, day, field) {
  return recs.filter((r) => r.date === day).reduce((s, r) => s + (r[field] ?? 0), 0);
}
function dayHours(recs, day, direction) {
  const byH = {};
  for (const r of recs) {
    if (r.date === day) byH[r.hour] = r;
  }
  const out = [];
  for (let h = 1; h <= 24; h++) {
    const r = byH[h];
    out.push(
      r ? {
        hour: h,
        direction,
        price: r.price,
        oc: r.oc,
        rps: r.rps,
        cov: r.cov,
        winners: r.winners
      } : {
        hour: h,
        direction,
        price: null,
        oc: null,
        rps: null,
        cov: null,
        winners: []
      }
    );
  }
  return out;
}
function delta(a, b) {
  const abs = Math.round((b - a) * 100) / 100;
  const pct = a ? Math.round((b - a) / a * 1e3) / 10 : b ? 100 : 0;
  return { abs, pct };
}
async function buildSnapshot(d1, d2) {
  const { byDir, allDates, at } = await loadAllDirections();
  if (allDates.length < 1) {
    return {
      error: "\u041D\u0435\u043C\u0430\u0454 \u0434\u0430\u0442 \u0443 \u0442\u0430\u0431\u043B\u0438\u0446\u0456",
      meta: { directions: DIR_ORDER, available_dates: [] }
    };
  }
  const day2 = d2 && allDates.includes(d2) ? d2 : allDates[allDates.length - 1];
  let day1 = d1 && allDates.includes(d1) ? d1 : null;
  if (!day1) {
    const idx = allDates.indexOf(day2);
    day1 = idx > 0 ? allDates[idx - 1] : day2;
  }
  const directions = DIR_ORDER.filter((d) => byDir[d]?.length);
  const compare = {};
  const hourly = {
    d1: {},
    d2: {}
  };
  const winnersAgg = {};
  for (const d of DIR_ORDER) {
    const recs = byDir[d] || [];
    const oc1 = daySum(recs, day1, "oc");
    const oc2 = daySum(recs, day2, "oc");
    const rps1 = daySum(recs, day1, "rps");
    const rps2 = daySum(recs, day2, "rps");
    const prices1 = recs.filter((r) => r.date === day1 && r.price != null).map((r) => r.price);
    const prices2 = recs.filter((r) => r.date === day2 && r.price != null).map((r) => r.price);
    const avg = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 100) / 100 : null;
    compare[d] = {
      oc1,
      oc2,
      oc_d: delta(oc1, oc2),
      rps1,
      rps2,
      rps_d: delta(rps1, rps2),
      price1: avg(prices1),
      price2: avg(prices2),
      cov1: oc1 ? Math.round(rps1 / oc1 * 1e4) / 100 : null,
      cov2: oc2 ? Math.round(rps2 / oc2 * 1e4) / 100 : null,
      side: isImport(d) ? "import" : "export"
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
  const winners_cmp = Object.entries(winnersAgg).map(([company, v]) => {
    const v1 = Math.round(v.v1 * 10) / 10;
    const v2 = Math.round(v.v2 * 10) / 10;
    return {
      company,
      v1,
      v2,
      d: delta(v1, v2)
    };
  }).sort((a, b) => Math.abs(b.d.abs) - Math.abs(a.d.abs));
  const endIdx = allDates.indexOf(day2);
  const startIdx = Math.max(0, endIdx - 13);
  const window = allDates.slice(startIdx, endIdx + 1);
  const day_totals = [];
  let prev = null;
  for (const day of window) {
    const row = {
      date: day,
      oc: 0,
      rps: 0,
      imp_oc: 0,
      exp_oc: 0,
      imp_rps: 0,
      exp_rps: 0,
      directions: {}
    };
    for (const d of DIR_ORDER) {
      const recs = byDir[d] || [];
      const oc = daySum(recs, day, "oc");
      const rps = daySum(recs, day, "rps");
      row.directions[d] = {
        oc,
        rps,
        coverage: oc ? Math.round(rps / oc * 1e4) / 100 : null
      };
      row.oc += oc;
      row.rps += rps;
      if (isImport(d)) {
        row.imp_oc += oc;
        row.imp_rps += rps;
      } else {
        row.exp_oc += oc;
        row.exp_rps += rps;
      }
    }
    if (prev) {
      row.doc = Math.round((row.oc - prev.oc) * 10) / 10;
      row.drps = Math.round((row.rps - prev.rps) * 10) / 10;
      row.dimp = Math.round((row.imp_oc - prev.imp_oc) * 10) / 10;
      row.dexp = Math.round((row.exp_oc - prev.exp_oc) * 10) / 10;
    } else {
      row.doc = row.drps = row.dimp = row.dexp = null;
    }
    day_totals.push(row);
    prev = {
      oc: row.oc,
      rps: row.rps,
      imp_oc: row.imp_oc,
      exp_oc: row.exp_oc
    };
  }
  const flowFor = (day) => {
    let imp_oc = 0, exp_oc = 0, imp_rps = 0, exp_rps = 0;
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
      cache_ttl_sec: CACHE_TTL_MS / 1e3
    },
    flow: {
      d1: f1,
      d2: f2,
      delta: {
        imp_oc: delta(f1.imp_oc, f2.imp_oc),
        exp_oc: delta(f1.exp_oc, f2.exp_oc),
        imp_rps: delta(f1.imp_rps, f2.imp_rps),
        exp_rps: delta(f1.exp_rps, f2.exp_rps)
      }
    },
    compare,
    day_totals,
    hourly,
    winners_cmp
  };
}
export {
  DIR_GIDS,
  buildSnapshot,
  loadAllDirections
};
