import { createServerFn } from "@tanstack/react-start";
import {
  ZONES,
  type Zone,
  type ZoneId,
} from "./zones";
import type { CellQuote, DailyEuUa, DecadeSummary, MarketReport } from "./market-types";
import { enumerateDates, addDaysIso, isoToday } from "./utils";
import { isoWeekMaturity } from "./zones";
import {
  fetchCache,
  sleep,
  mapPool,
  lastPoint,
  lastPointBefore,
  pointOnDate,
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

function isoDateRe(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseInput(data: unknown): { startDate: string; endDate: string } {
  if (!data || typeof data !== "object") throw new Error("Некоректний запит");
  const rec = data as Record<string, unknown>;
  if (!isoDateRe(rec.startDate) || !isoDateRe(rec.endDate)) {
    throw new Error("Дати мають бути у форматі YYYY-MM-DD");
  }
  if (rec.startDate > rec.endDate) throw new Error("Початкова дата пізніша за кінцеву");
  const dates = enumerateDates(rec.startDate, rec.endDate);
  if (dates.length === 0) throw new Error("Порожній період");
  if (dates.length > 62) throw new Error("Максимум 62 дні за один запит");
  return { startDate: rec.startDate, endDate: rec.endDate };
}

export const loadMarket = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(data))
  .handler(async ({ data }): Promise<MarketReport> => {
    const { startDate, endDate } = data;
    const dates = enumerateDates(startDate, endDate);
    const warnings: string[] = [];

    // Пайплайн: Spot → Day (низька concurrency + retry) → Month послідовно → Week/Weekend
    fetchCache.clear();
    const today = isoToday();
    const dayJobs: { zone: Zone; date: string }[] = [];
    for (const zone of ZONES) {
      if (!zone.dayPrefix) continue;
      for (const date of dates) dayJobs.push({ zone, date });
    }

    const { spot, uaUah } = await fetchSpot(startDate, endDate);

    let daySeries = await mapPool(dayJobs, 3, async (job) => ({
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
      await sleep(pass === 0 ? 1_200 : 2_500);
      const retried = await mapPool(missingDay, 2, async (s) => {
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

    // Month — послідовно по зонах
    await sleep(600);
    let monthSeries: EexPoint[][] = [];
    for (let i = 0; i < ZONES.length; i++) {
      const pts = await fetchMonthContract(ZONES[i], startDate, endDate);
      monthSeries.push(pts);
      if (i < ZONES.length - 1) await sleep(350);
    }
    const emptyMonthIdx = monthSeries
      .map((pts, i) => (pts.length === 0 ? i : -1))
      .filter((i) => i >= 0);
    if (emptyMonthIdx.length) {
      await sleep(2_000);
      for (const i of emptyMonthIdx) {
        monthSeries[i] = await fetchMonthContract(ZONES[i], startDate, endDate);
        await sleep(500);
      }
    }

    const [weekSeries, weekendSeries, eurUah] = await Promise.all([
      mapPool(ZONES, 2, (z) => fetchWeekContract(z, startDate, endDate)),
      mapPool(ZONES, 2, (z) => fetchWeekendContract(z, startDate, endDate)),
      fetchEurUah(fxDate),
    ]);

    const emptyDays = daySeries.filter((s) => s.points.length === 0).length;
    if (emptyDays > 0) {
      warnings.push(
        `Day: ${emptyDays}/${dayJobs.length} без settlement (forward-fill заповнить прогалини).`,
      );
    }

    const monthByZone: Record<ZoneId, EexPoint[]> = {} as Record<ZoneId, EexPoint[]>;
    const weekByZone: Record<ZoneId, EexPoint[]> = {} as Record<ZoneId, EexPoint[]>;
    const weekendByZone: Record<ZoneId, EexPoint[]> = {} as Record<ZoneId, EexPoint[]>;
    ZONES.forEach((z, i) => {
      monthByZone[z.id] = monthSeries[i];
      weekByZone[z.id] = weekSeries[i];
      weekendByZone[z.id] = weekendSeries[i];
      if (monthSeries[i].length === 0) {
        warnings.push(
          `Month ${z.id} (${z.monthCode}): немає settlement у public API — у таблиці буде «—» (спробуйте вужчий період або пізніше).`,
        );
      }
    });

    const dayByKey = new Map(daySeries.map((s) => [s.key, s.points]));

    const rows: MarketReport["rows"] = {};
    for (const date of dates) {
      rows[date] = {} as Record<ZoneId, CellQuote>;
      for (const zone of ZONES) {
        const spotPx = spot[date]?.[zone.id] ?? null;
        const dayPts = zone.dayPrefix ? (dayByKey.get(`${zone.id}:${date}`) ?? []) : [];
        const dayPt =
          date <= today
            ? lastPointBefore(dayPts, date)
            : lastPoint(dayPts) ?? lastPointBefore(dayPts, date);
        const weekPt =
          pointOnDate(weekByZone[zone.id] ?? [], date) ??
          lastPoint(weekByZone[zone.id] ?? []);
        const weekendPt =
          pointOnDate(weekendByZone[zone.id] ?? [], date) ??
          lastPoint(weekendByZone[zone.id] ?? []);
        const monthPts = monthByZone[zone.id] ?? [];
        const monthPt =
          pointOnDate(monthPts, date) ??
          lastPointBefore(monthPts, addDaysIso(date, 1)) ??
          lastPoint(monthPts);

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

    // Forward-fill Day
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

    // Forward-fill Month
    for (const zone of ZONES) {
      let last: number | null = null;
      let lastTd: string | null = null;
      for (const date of dates) {
        const cell = rows[date]?.[zone.id];
        if (!cell) continue;
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

    // Week/Weekend from Day archive if EEX empty
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
          const px = rows[d]?.[zone.id]?.dayFutures;
          if (px === null || px === undefined) continue;
          dayVals.push(px);
          if (weekdayUTC(d) >= 6) weVals.push(px);
        }
        const weekAvg = dayVals.length
          ? Math.round((dayVals.reduce((a, b) => a + b, 0) / dayVals.length) * 100) / 100
          : null;
        const weAvg = weVals.length
          ? Math.round((weVals.reduce((a, b) => a + b, 0) / weVals.length) * 100) / 100
          : null;
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
      for (const date of dates) {
        const cell = rows[date]?.[zone.id];
        if (!cell) continue;
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

    const euUa: DailyEuUa[] = dates.map((date) => {
      const zonePrices: number[] = [];
      for (const z of ZONES) {
        const px = rows[date]?.[z.id]?.spot;
        if (px !== null && px !== undefined) zonePrices.push(px);
      }
      const euAvg = mean(zonePrices);
      const uaUahPx = uaUah[date] ?? null;
      const uaRdnEur =
        uaUahPx !== null && eurUah > 0 ? Math.round((uaUahPx / eurUah) * 100) / 100 : null;
      let deltaPct: number | null = null;
      if (uaRdnEur !== null && euAvg !== null && euAvg !== 0) {
        deltaPct = Math.round(((uaRdnEur - euAvg) / euAvg) * 10000) / 100;
      }
      return { date, euAvg, uaRdnEur, uaRdnUah: uaUahPx, deltaPct, eurUah };
    });

    const decadeKeys = new Map<string, { start: string; end: string; label: string }>();
    for (const d of dates) {
      const b = decadeBounds(d);
      decadeKeys.set(b.label, b);
    }
    const decades: DecadeSummary[] = [...decadeKeys.values()].map((b) => {
      const spots: number[] = [];
      const days: number[] = [];
      const weeks: number[] = [];
      const weekends: number[] = [];
      for (const d of dates) {
        if (d < b.start || d > b.end) continue;
        const eu = euUa.find((x) => x.date === d)?.euAvg;
        if (eu !== null && eu !== undefined) spots.push(eu);
        const dayVals: number[] = [];
        const weekVals: number[] = [];
        const weVals: number[] = [];
        for (const z of ZONES) {
          const cell = rows[d]?.[z.id];
          if (!cell) continue;
          if (cell.dayFutures !== null) dayVals.push(cell.dayFutures);
          if (cell.weekFutures !== null) weekVals.push(cell.weekFutures);
          if (cell.weekendFutures !== null) weVals.push(cell.weekendFutures);
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

    warnings.push(
      "Week/Weekend: де можливо — EEX; інакше середнє Day-архіву (публічний feed часто без settlement для Week).",
    );

    return {
      startDate,
      endDate,
      fetchedAt: new Date().toISOString(),
      dates,
      zones: ZONES.map((z) => z.id),
      rows,
      euUa,
      decades,
      warnings,
      sources: {
        eex: "EEX Day+Month settlement; Week/Weekend = Day-архів середнє",
        spot: "Energy-Charts / Fraunhofer ISE — Day Ahead Auction",
        ua: "Energy-Charts UA-IPS (UAH) → EUR за курсом НБУ",
      },
    };
  });
