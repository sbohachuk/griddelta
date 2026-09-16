import { createServerFn } from "@tanstack/react-start";
import { ZONES, type Zone, type ZoneId, isoWeekMaturity, monthMaturity } from "./zones";
import type { CellQuote, DailyEuUa, DecadeSummary, MarketReport } from "./market-types";
import { enumerateDates, addDaysIso, isoToday } from "./utils";
import {
  fetchCache,
  sleep,
  mapPool,
  lastPoint,
  lastPointBefore,
  fetchDayContract,
  fetchWeekContract,
  fetchWeekendContract,
  fetchMonthContract,
  fetchSpot,
  fetchEurUah,
  delta,
  mean,
  decadeBounds,
  type EexPoint,
} from "./market-eex";
import {
  loadCachedZoneQuotes,
  loadCachedEuUa,
  datesNeedingFetch,
  upsertZoneQuotes,
  upsertEuUa,
  fillDeltas,
} from "./market-cache";

function isoDateRe(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseInput(data: unknown): {
  startDate: string;
  endDate: string;
  phase: "spot" | "full";
} {
  if (!data || typeof data !== "object") throw new Error("Некоректний запит");
  const rec = data as Record<string, unknown>;
  if (!isoDateRe(rec.startDate) || !isoDateRe(rec.endDate)) {
    throw new Error("Дати мають бути у форматі YYYY-MM-DD");
  }
  if (rec.startDate > rec.endDate) throw new Error("Початкова дата пізніша за кінцеву");
  const dates = enumerateDates(rec.startDate, rec.endDate);
  if (dates.length === 0) throw new Error("Порожній період");
  if (dates.length > 62) throw new Error("Максимум 62 дні за один запит");
  const phase = rec.phase === "spot" ? "spot" : "full";
  return { startDate: rec.startDate, endDate: rec.endDate, phase };
}

function emptyCell(): CellQuote {
  return {
    spot: null,
    dayFutures: null,
    weekFutures: null,
    weekendFutures: null,
    monthFutures: null,
    dayDeltaEur: null,
    dayDeltaPct: null,
    weekDeltaEur: null,
    weekDeltaPct: null,
    weekendDeltaEur: null,
    weekendDeltaPct: null,
    monthDeltaEur: null,
    monthDeltaPct: null,
    dayTradeDate: null,
    weekTradeDate: null,
    weekendTradeDate: null,
    monthTradeDate: null,
  };
}

function buildEuUa(
  dates: string[],
  rows: MarketReport["rows"],
  uaUah: Record<string, number>,
  euUaCache: Map<string, DailyEuUa>,
  eurUah: number,
): DailyEuUa[] {
  return dates.map((date) => {
    const cached = euUaCache.get(date);
    const zonePrices: number[] = [];
    for (const z of ZONES) {
      const px = rows[date]?.[z.id]?.spot;
      if (px !== null && px !== undefined) zonePrices.push(px);
    }
    const euAvg = mean(zonePrices) ?? cached?.euAvg ?? null;
    const uaUahPx = uaUah[date] ?? cached?.uaRdnUah ?? null;
    const uaRdnEur =
      uaUahPx !== null && eurUah > 0
        ? Math.round((uaUahPx / eurUah) * 100) / 100
        : (cached?.uaRdnEur ?? null);
    let deltaPct: number | null = null;
    if (uaRdnEur !== null && euAvg !== null && euAvg !== 0) {
      deltaPct = Math.round(((uaRdnEur - euAvg) / euAvg) * 10000) / 100;
    }
    return {
      date,
      euAvg,
      uaRdnEur,
      uaRdnUah: uaUahPx,
      deltaPct,
      eurUah: cached?.eurUah ?? eurUah,
    };
  });
}

function buildDecades(
  dates: string[],
  rows: MarketReport["rows"],
  euUa: DailyEuUa[],
  eurUah: number,
): DecadeSummary[] {
  const decadeKeys = new Map<string, { start: string; end: string; label: string }>();
  for (const d of dates) {
    const b = decadeBounds(d);
    decadeKeys.set(b.label, b);
  }
  return [...decadeKeys.values()].map((b) => {
    const spots: number[] = [];
    const days: number[] = [];
    const weeks: number[] = [];
    const weekends: number[] = [];
    const uaEur: number[] = [];
    const uaUahVals: number[] = [];
    for (const d of dates) {
      if (d < b.start || d > b.end) continue;
      const euRow = euUa.find((x) => x.date === d);
      if (euRow?.euAvg != null) spots.push(euRow.euAvg);
      if (euRow?.uaRdnEur != null) uaEur.push(euRow.uaRdnEur);
      if (euRow?.uaRdnUah != null) uaUahVals.push(euRow.uaRdnUah);
      const dayVals: number[] = [];
      const weekVals: number[] = [];
      const weVals: number[] = [];
      for (const z of ZONES) {
        const c = rows[d]?.[z.id];
        if (!c) continue;
        if (c.dayFutures !== null) dayVals.push(c.dayFutures);
        if (c.weekFutures !== null) weekVals.push(c.weekFutures);
        if (c.weekendFutures !== null) weVals.push(c.weekendFutures);
      }
      const dm = mean(dayVals);
      const wm = mean(weekVals);
      const wem = mean(weVals);
      if (dm !== null) days.push(dm);
      if (wm !== null) weeks.push(wm);
      if (wem !== null) weekends.push(wem);
    }
    const euAvgEur = mean(spots);
    const dayAvg = mean(days);
    const weekAvg = mean(weeks);
    const weekendAvg = mean(weekends);
    const uaRdnAvgEur = mean(uaEur);
    const uaRdnAvgUah = mean(uaUahVals);
    const dDay = delta(dayAvg, euAvgEur);
    const dWeek = delta(weekAvg, euAvgEur);
    const disc = (pct: number) =>
      euAvgEur === null ? null : Math.round(euAvgEur * (1 - pct / 100) * 100) / 100;
    const toUah = (eur: number | null) =>
      eur === null ? null : Math.round(eur * eurUah * 100) / 100;
    return {
      label: b.label,
      periodStart: b.start,
      periodEnd: b.end,
      euAvgEur,
      dayAvgEur: dayAvg,
      weekAvgEur: weekAvg,
      weekendAvgEur: weekendAvg,
      uaRdnAvgEur,
      uaRdnAvgUah,
      dayDeltaEur: dDay.eur,
      dayDeltaPct: dDay.pct,
      weekDeltaEur: dWeek.eur,
      weekDeltaPct: dWeek.pct,
      disc30Eur: disc(30),
      disc20Eur: disc(20),
      disc10Eur: disc(10),
      disc30Uah: toUah(disc(30)),
      disc20Uah: toUah(disc(20)),
      disc10Uah: toUah(disc(10)),
      eurUah,
    };
  });
}

/** Лише Spot + UA — швидко, для першої візуалізації */
async function fetchSpotOnly(
  dates: string[],
  warnings: string[],
): Promise<{
  rows: Record<string, Record<ZoneId, CellQuote>>;
  uaUah: Record<string, number>;
  eurUah: number;
}> {
  if (!dates.length) return { rows: {}, uaUah: {}, eurUah: 46.5 };
  const startDate = dates[0]!;
  const endDate = dates[dates.length - 1]!;
  const today = isoToday();
  fetchCache.clear();
  const { spot, uaUah } = await fetchSpot(startDate, endDate);
  const fxDate = endDate <= today ? endDate : startDate;
  const eurUah = await fetchEurUah(fxDate);
  const rows: Record<string, Record<ZoneId, CellQuote>> = {};
  let spotHits = 0;
  for (const date of dates) {
    rows[date] = {} as Record<ZoneId, CellQuote>;
    for (const zone of ZONES) {
      const spotPx = spot[date]?.[zone.id] ?? null;
      if (spotPx !== null) spotHits += 1;
      rows[date][zone.id] = { ...emptyCell(), spot: spotPx };
    }
  }
  warnings.push(`Spot-фаза: ${spotHits} значень spot по зонах/днях (ф’ючерси підвантажаться далі).`);
  return { rows, uaUah, eurUah };
}

async function fetchLiveRange(
  fetchDates: string[],
  warnings: string[],
): Promise<{
  rows: Record<string, Record<ZoneId, CellQuote>>;
  uaUah: Record<string, number>;
  eurUah: number;
}> {
  if (!fetchDates.length) {
    return { rows: {}, uaUah: {}, eurUah: 46.5 };
  }
  const startDate = fetchDates[0]!;
  const endDate = fetchDates[fetchDates.length - 1]!;
  const today = isoToday();
  fetchCache.clear();

  const dayJobs: { zone: Zone; date: string }[] = [];
  for (const zone of ZONES) {
    if (!zone.dayPrefix) continue;
    for (const date of fetchDates) dayJobs.push({ zone, date });
  }

  // Spot завжди першим (паралельно з day можна, але spot критичний)
  const { spot, uaUah } = await fetchSpot(startDate, endDate);

  let daySeries = await mapPool(dayJobs, 6, async (job) => ({
    key: `${job.zone.id}:${job.date}`,
    points: await fetchDayContract(job.zone, job.date),
  }));

  for (let pass = 0; pass < 2; pass++) {
    const missingDay = daySeries.filter((s) => {
      if (s.points.length > 0) return false;
      const date = s.key.split(":")[1]!;
      return date <= today;
    });
    if (!missingDay.length) break;
    await sleep(pass === 0 ? 600 : 1_500);
    const retried = await mapPool(missingDay, 4, async (s) => {
      const [zoneId, date] = s.key.split(":");
      const zone = ZONES.find((z) => z.id === zoneId)!;
      return { key: s.key, points: await fetchDayContract(zone, date) };
    });
    const byKey = new Map(daySeries.map((s) => [s.key, s]));
    for (const r of retried) {
      if (r.points.length) byKey.set(r.key, r);
    }
    daySeries = [...byKey.values()];
  }

  const fxDate = endDate <= today ? endDate : startDate;

  const monthMaps = await mapPool(ZONES, 4, (z) => fetchMonthContract(z, startDate, endDate));
  const emptyMonthIdx = monthMaps
    .map((m, i) => (m.size === 0 ? i : -1))
    .filter((i) => i >= 0);
  if (emptyMonthIdx.length) {
    await sleep(1_000);
    const retriedMonth = await mapPool(emptyMonthIdx, 3, (i) =>
      fetchMonthContract(ZONES[i]!, startDate, endDate),
    );
    emptyMonthIdx.forEach((i, idx) => {
      monthMaps[i] = retriedMonth[idx]!;
    });
  }

  const [weekMaps, weekendMaps, eurUah] = await Promise.all([
    mapPool(ZONES, 4, (z) => fetchWeekContract(z, startDate, endDate)),
    mapPool(ZONES, 4, (z) => fetchWeekendContract(z, startDate, endDate)),
    fetchEurUah(fxDate),
  ]);

  const emptyDays = daySeries.filter((s) => s.points.length === 0).length;
  if (emptyDays > 0) {
    warnings.push(
      `Day: ${emptyDays}/${dayJobs.length} без settlement (forward-fill / кеш).`,
    );
  }

  const monthByZone: Record<ZoneId, Map<string, EexPoint[]>> = {} as Record<
    ZoneId,
    Map<string, EexPoint[]>
  >;
  const weekByZone: Record<ZoneId, Map<number, EexPoint[]>> = {} as Record<
    ZoneId,
    Map<number, EexPoint[]>
  >;
  const weekendByZone: Record<ZoneId, Map<number, EexPoint[]>> = {} as Record<
    ZoneId,
    Map<number, EexPoint[]>
  >;
  ZONES.forEach((z, i) => {
    monthByZone[z.id] = monthMaps[i]!;
    weekByZone[z.id] = weekMaps[i]!;
    weekendByZone[z.id] = weekendMaps[i]!;
    if (monthMaps[i]!.size === 0) {
      warnings.push(`Month ${z.id} (${z.monthCode}): немає settlement у public API.`);
    }
  });

  const dayByKey = new Map(daySeries.map((s) => [s.key, s.points]));
  const rows: Record<string, Record<ZoneId, CellQuote>> = {};

  for (const date of fetchDates) {
    rows[date] = {} as Record<ZoneId, CellQuote>;
    const matMonth = monthMaturity(date);
    const matWeek = isoWeekMaturity(date);
    for (const zone of ZONES) {
      const spotPx = spot[date]?.[zone.id] ?? null;
      const dayPts = zone.dayPrefix ? (dayByKey.get(`${zone.id}:${date}`) ?? []) : [];
      const dayPt =
        date <= today
          ? lastPointBefore(dayPts, date)
          : lastPoint(dayPts) ?? lastPointBefore(dayPts, date);

      // Week/Weekend: last settlement контракту тижня поставки (не tradeDate = day)
      const weekPts = weekByZone[zone.id]?.get(matWeek) ?? [];
      const weekendPts = weekendByZone[zone.id]?.get(matWeek) ?? [];
      const weekPt = lastPointBefore(weekPts, addDaysIso(date, 1)) ?? lastPoint(weekPts);
      const weekendPt =
        lastPointBefore(weekendPts, addDaysIso(date, 1)) ?? lastPoint(weekendPts);

      // Month: last settlement maturity місяця поставки (жовтень ← settl з вересня OK)
      const monthPts = monthByZone[zone.id]?.get(matMonth) ?? [];
      const monthPt =
        lastPointBefore(monthPts, addDaysIso(date, 1)) ?? lastPoint(monthPts);

      const dayPx = dayPt?.settlPx ?? null;
      const weekPx = weekPt?.settlPx ?? null;
      const weekendPx = weekendPt?.settlPx ?? null;
      const monthPx = monthPt?.settlPx ?? null;
      const dDay = delta(dayPx, spotPx);
      const dWeek = delta(weekPx, spotPx);
      const dWeekend = delta(weekendPx, spotPx);
      const dMonth = delta(monthPx, spotPx);

      rows[date][zone.id] = {
        spot: spotPx,
        dayFutures: dayPx,
        weekFutures: weekPx,
        weekendFutures: weekendPx,
        monthFutures: monthPx,
        dayDeltaEur: dDay.eur,
        dayDeltaPct: dDay.pct,
        weekDeltaEur: dWeek.eur,
        weekDeltaPct: dWeek.pct,
        weekendDeltaEur: dWeekend.eur,
        weekendDeltaPct: dWeekend.pct,
        monthDeltaEur: dMonth.eur,
        monthDeltaPct: dMonth.pct,
        dayTradeDate: dayPt?.tradeDate ?? null,
        weekTradeDate: weekPt?.tradeDate ?? null,
        weekendTradeDate: weekendPt?.tradeDate ?? null,
        monthTradeDate: monthPt?.tradeDate ?? null,
      };
    }
  }

  return { rows, uaUah, eurUah };
}

function applyForwardFills(dates: string[], rows: MarketReport["rows"]) {
  for (const zone of ZONES) {
    if (!zone.dayPrefix) continue;
    let last: number | null = null;
    let lastTd: string | null = null;
    for (const date of dates) {
      const cell = rows[date]?.[zone.id];
      if (!cell) continue;
      if (cell.dayFutures !== null) {
        last = cell.dayFutures;
        lastTd = cell.dayTradeDate;
      } else if (last !== null) {
        cell.dayFutures = last;
        cell.dayTradeDate = lastTd;
        const dDay = delta(last, cell.spot);
        cell.dayDeltaEur = dDay.eur;
        cell.dayDeltaPct = dDay.pct;
      }
    }
  }

  // Month: forward-fill within same calendar month only (одна maturity)
  for (const zone of ZONES) {
    let last: number | null = null;
    let lastTd: string | null = null;
    let lastMat: string | null = null;
    for (const date of dates) {
      const cell = rows[date]?.[zone.id];
      if (!cell) continue;
      const mat = monthMaturity(date);
      if (mat !== lastMat) {
        last = null;
        lastTd = null;
        lastMat = mat;
      }
      if (cell.monthFutures !== null) {
        last = cell.monthFutures;
        lastTd = cell.monthTradeDate;
      } else if (last !== null) {
        cell.monthFutures = last;
        cell.monthTradeDate = lastTd;
        const dM = delta(last, cell.spot);
        cell.monthDeltaEur = dM.eur;
        cell.monthDeltaPct = dM.pct;
      }
    }
  }

  function isoWeekKey(iso: string): string {
    return String(isoWeekMaturity(iso));
  }
  function weekdayUTC(iso: string): number {
    const d = new Date(`${iso}T12:00:00Z`).getUTCDay();
    return d === 0 ? 7 : d;
  }
  const byWeek = new Map<string, string[]>();
  for (const d of dates) {
    const k = isoWeekKey(d);
    if (!byWeek.has(k)) byWeek.set(k, []);
    byWeek.get(k)!.push(d);
  }
  for (const zone of ZONES) {
    for (const [, weekDates] of byWeek) {
      const dayVals: number[] = [];
      const weVals: number[] = [];
      for (const d of weekDates) {
        const cell = rows[d]?.[zone.id];
        if (!cell) continue;
        const px = cell.dayFutures ?? cell.spot;
        if (px === null || px === undefined) continue;
        dayVals.push(px);
        if (weekdayUTC(d) >= 6) weVals.push(px);
      }
      const weekAvg = dayVals.length
        ? Math.round((dayVals.reduce((a, b) => a + b, 0) / dayVals.length) * 100) / 100
        : null;
      const weAvg = weVals.length
        ? Math.round((weVals.reduce((a, b) => a + b, 0) / weVals.length) * 100) / 100
        : weekAvg;
      for (const d of weekDates) {
        const cell = rows[d]?.[zone.id];
        if (!cell) continue;
        if (cell.weekFutures === null && weekAvg !== null) {
          cell.weekFutures = weekAvg;
          const dW = delta(weekAvg, cell.spot);
          cell.weekDeltaEur = dW.eur;
          cell.weekDeltaPct = dW.pct;
        }
        if (cell.weekendFutures === null && weAvg !== null) {
          cell.weekendFutures = weAvg;
          const dWe = delta(weAvg, cell.spot);
          cell.weekendDeltaEur = dWe.eur;
          cell.weekendDeltaPct = dWe.pct;
        }
      }
    }
  }

  for (const zone of ZONES) {
    let lastW: number | null = null;
    let lastWe: number | null = null;
    let lastWk: string | null = null;
    for (const date of dates) {
      const cell = rows[date]?.[zone.id];
      if (!cell) continue;
      const wk = isoWeekKey(date);
      if (wk !== lastWk) {
        lastW = null;
        lastWe = null;
        lastWk = wk;
      }
      if (cell.weekFutures !== null) lastW = cell.weekFutures;
      else if (lastW !== null) {
        cell.weekFutures = lastW;
        const dW = delta(lastW, cell.spot);
        cell.weekDeltaEur = dW.eur;
        cell.weekDeltaPct = dW.pct;
      }
      if (cell.weekendFutures !== null) lastWe = cell.weekendFutures;
      else if (lastWe !== null) {
        cell.weekendFutures = lastWe;
        const dWe = delta(lastWe, cell.spot);
        cell.weekendDeltaEur = dWe.eur;
        cell.weekendDeltaPct = dWe.pct;
      }
    }
  }
}

export const loadMarket = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(data))
  .handler(async ({ data }): Promise<MarketReport> => {
    const { startDate, endDate, phase } = data;
    const dates = enumerateDates(startDate, endDate);
    const warnings: string[] = [];
    const today = isoToday();

    const [zoneCache, euUaCache] = await Promise.all([
      loadCachedZoneQuotes(startDate, endDate),
      loadCachedEuUa(startDate, endDate),
    ]);

    // ——— SPOT PHASE: швидко, без EEX futures ———
    if (phase === "spot") {
      const needFetch = datesNeedingFetch(dates, today, zoneCache);
      let liveRows: Record<string, Record<ZoneId, CellQuote>> = {};
      let uaUah: Record<string, number> = {};
      let eurUah = 46.5;

      if (needFetch.length > 0) {
        const live = await fetchSpotOnly(needFetch, warnings);
        liveRows = live.rows;
        uaUah = live.uaUah;
        eurUah = live.eurUah;
      } else if (euUaCache.size) {
        for (const d of dates) {
          const e = euUaCache.get(d);
          if (e?.eurUah) {
            eurUah = e.eurUah;
            break;
          }
        }
        warnings.push("Spot-фаза: усе з кешу.");
      }

      const rows: MarketReport["rows"] = {};
      for (const date of dates) {
        rows[date] = {} as Record<ZoneId, CellQuote>;
        for (const zone of ZONES) {
          const cached = zoneCache.get(date)?.get(zone.id);
          const live = liveRows[date]?.[zone.id];
          if (live) {
            rows[date][zone.id] = fillDeltas({
              ...emptyCell(),
              spot: live.spot,
              dayFutures: cached?.dayFutures ?? null,
              weekFutures: cached?.weekFutures ?? null,
              weekendFutures: cached?.weekendFutures ?? null,
              monthFutures: cached?.monthFutures ?? null,
              dayTradeDate: cached?.dayTradeDate ?? null,
              weekTradeDate: cached?.weekTradeDate ?? null,
              weekendTradeDate: cached?.weekendTradeDate ?? null,
              monthTradeDate: cached?.monthTradeDate ?? null,
            });
          } else if (cached) {
            rows[date][zone.id] = fillDeltas({ ...cached });
          } else {
            rows[date][zone.id] = emptyCell();
          }
        }
      }

      const euUa = buildEuUa(dates, rows, uaUah, euUaCache, eurUah);
      const toStore: { date: string; zoneId: ZoneId; cell: CellQuote }[] = [];
      for (const date of dates) {
        if (date > today) continue;
        for (const zone of ZONES) {
          const cell = rows[date]?.[zone.id];
          if (cell?.spot !== null) toStore.push({ date, zoneId: zone.id, cell });
        }
      }
      await upsertZoneQuotes(toStore);
      await upsertEuUa(euUa.filter((e) => e.date <= today));

      return {
        startDate,
        endDate,
        fetchedAt: new Date().toISOString(),
        dates,
        zones: ZONES.map((z) => z.id),
        rows,
        euUa,
        decades: buildDecades(dates, rows, euUa, eurUah),
        warnings,
        sources: {
          eex: "(spot-фаза — ф’ючерси ще підвантажуються)",
          spot: "Energy-Charts Day Ahead + кеш",
          ua: "Energy-Charts UA-IPS + НБУ",
        },
      };
    }

    // ——— FULL PHASE ———
    const needFetch = datesNeedingFetch(dates, today, zoneCache);
    const cachedCount = dates.length - needFetch.length;
    if (cachedCount > 0) {
      warnings.push(`Кеш БД: ${cachedCount}/${dates.length} днів зі spot.`);
    }
    if (needFetch.length > 0) {
      warnings.push(
        `Живе оновлення: ${needFetch[0]}…${needFetch[needFetch.length - 1]} (${needFetch.length} дн.).`,
      );
    } else {
      warnings.push("Увесь період у кеші — API не викликався.");
    }

    let liveRows: Record<string, Record<ZoneId, CellQuote>> = {};
    let uaUah: Record<string, number> = {};
    let eurUah = 46.5;
    if (needFetch.length > 0) {
      const live = await fetchLiveRange(needFetch, warnings);
      liveRows = live.rows;
      uaUah = live.uaUah;
      eurUah = live.eurUah;
    } else if (euUaCache.size) {
      for (const d of dates) {
        const e = euUaCache.get(d);
        if (e?.eurUah) {
          eurUah = e.eurUah;
          break;
        }
      }
    }

    const rows: MarketReport["rows"] = {};
    for (const date of dates) {
      rows[date] = {} as Record<ZoneId, CellQuote>;
      for (const zone of ZONES) {
        const cached = zoneCache.get(date)?.get(zone.id);
        const live = liveRows[date]?.[zone.id];
        if (live) {
          rows[date][zone.id] = fillDeltas({ ...live });
        } else if (cached) {
          rows[date][zone.id] = fillDeltas({ ...cached });
        } else {
          rows[date][zone.id] = emptyCell();
        }
      }
    }

    applyForwardFills(dates, rows);

    const stillMissing = dates.filter((d) => {
      if (d >= today) return false;
      return ZONES.some((z) => rows[d]?.[z.id]?.spot === null);
    });
    if (stillMissing.length > 0 && stillMissing.length <= 20) {
      warnings.push(`Дозаповнення spot: ${stillMissing.length} днів.`);
      await sleep(1_000);
      const gap = await fetchLiveRange(stillMissing, warnings);
      for (const d of stillMissing) {
        for (const z of ZONES) {
          const g = gap.rows[d]?.[z.id];
          if (!g) continue;
          const cell = rows[d]![z.id]!;
          if (g.spot !== null) cell.spot = g.spot;
          if (g.dayFutures !== null) {
            cell.dayFutures = g.dayFutures;
            cell.dayTradeDate = g.dayTradeDate;
          }
          if (g.weekFutures !== null) cell.weekFutures = g.weekFutures;
          if (g.weekendFutures !== null) cell.weekendFutures = g.weekendFutures;
          if (g.monthFutures !== null) {
            cell.monthFutures = g.monthFutures;
            cell.monthTradeDate = g.monthTradeDate;
          }
          rows[d]![z.id] = fillDeltas(cell);
        }
        Object.assign(uaUah, gap.uaUah);
        if (gap.eurUah) eurUah = gap.eurUah;
      }
      applyForwardFills(dates, rows);
    }

    const euUa = buildEuUa(dates, rows, uaUah, euUaCache, eurUah);

    const toStore: { date: string; zoneId: ZoneId; cell: CellQuote }[] = [];
    for (const date of dates) {
      if (date > today) continue;
      for (const zone of ZONES) {
        const cell = rows[date]?.[zone.id];
        if (!cell) continue;
        if (cell.spot !== null || cell.dayFutures !== null || cell.monthFutures !== null) {
          toStore.push({ date, zoneId: zone.id, cell });
        }
      }
    }
    await upsertZoneQuotes(toStore);
    await upsertEuUa(euUa.filter((e) => e.date <= today));

    warnings.push("Month/Week: прив’язка до maturity поставки (не до trade date осі)." );

    return {
      startDate,
      endDate,
      fetchedAt: new Date().toISOString(),
      dates,
      zones: ZONES.map((z) => z.id),
      rows,
      euUa,
      decades: buildDecades(dates, rows, euUa, eurUah),
      warnings,
      sources: {
        eex: "EEX + кеш (month/week by delivery maturity)",
        spot: "Energy-Charts Day Ahead + кеш",
        ua: "Energy-Charts UA-IPS (UAH) → EUR (НБУ) + кеш",
      },
    };
  });
