import { useMemo, useState } from "react";
import {
  Activity,
  Download,
  Loader2,
  RefreshCw,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import type { MarketReport } from "@/lib/market-types";
import { useMarketReport } from "@/lib/market-queries";
import { ZONES, type ZoneId } from "@/lib/zones";
import { addDaysIso, cn, formatPct, formatPrice, isoToday, monthBounds } from "@/lib/utils";
import { downloadReportXls } from "@/lib/export-xls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DeltaChart, OverviewChart } from "@/components/delta-chart";
import { PriceTable, EuUaTable, DecadeTable } from "@/components/price-table";

function defaultRange() {
  // За замовчуванням — повний поточний місяць
  return monthBounds(isoToday());
}

function summarize(report: MarketReport, zone: ZoneId) {
  const dayDeltas: number[] = [];
  let dayCount = 0;
  let spotCount = 0;
  for (const date of report.dates) {
    const cell = report.rows[date]?.[zone];
    if (!cell) continue;
    if (cell.spot !== null) spotCount += 1;
    if (cell.dayFutures !== null) dayCount += 1;
    if (cell.dayDeltaEur !== null) dayDeltas.push(cell.dayDeltaEur);
  }
  const avg =
    dayDeltas.length === 0
      ? null
      : Math.round((dayDeltas.reduce((a, b) => a + b, 0) / dayDeltas.length) * 100) / 100;
  const absMax =
    dayDeltas.length === 0
      ? null
      : dayDeltas.reduce((best, v) => (Math.abs(v) > Math.abs(best) ? v : best), 0);
  return { avg, absMax, dayCount, spotCount, n: report.dates.length };
}

export function Dashboard() {
  const initial = useMemo(() => defaultRange(), []);
  const [startDate, setStartDate] = useState(initial.start);
  const [endDate, setEndDate] = useState(initial.end);
  const [applied, setApplied] = useState(initial);
  const [zone, setZone] = useState<ZoneId>("DE");
  /** Розріз звіту: дні (подобово) | декади (1–10 / 11–20 / 21–кінець) */
  const [viewMode, setViewMode] = useState<"days" | "decades">("days");

  const {
    report,
    isLoading: marketLoading,
    isFetching: marketFetching,
    isError: marketError,
    error: marketErr,
    loadingFutures,
  } = useMarketReport(applied.start, applied.end);
  const query = {
    isLoading: marketLoading,
    isFetching: marketFetching,
    isError: marketError,
    error: marketErr,
    data: report,
  };
  const stats = report ? summarize(report, zone) : null;
  const zoneMeta = ZONES.find((z) => z.id === zone)!;

  function applyRange() {
    if (startDate > endDate) {
      toast.error("Початкова дата пізніша за кінцеву");
      return;
    }
    setApplied({ start: startDate, end: endDate });
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="pointer-events-none fixed inset-y-0 left-0 w-px bg-border" />
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-xl">
              <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                Power desk
              </p>
              <h1 className="mt-2 font-display text-[clamp(2rem,4vw,3.25rem)] leading-[1.05] tracking-[-0.03em]">
                GridDelta
              </h1>
              <p className="mt-3 max-w-prose text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base">
                Подобові Base-ф’ючерси EEX проти day-ahead споту Energy-Charts. Дельта в
                EUR/MWh і відсотках по дев’яти зонах.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">EUR / MWh</Badge>
              <Badge variant="outline">Base</Badge>
            </div>
          </div>

          <form
            className="grid gap-3 rounded-[var(--radius-xl)] border border-border bg-card p-4 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              applyRange();
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="start">Від</Label>
              <Input
                id="start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="end">До</Label>
              <Input
                id="end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={query.isFetching} className="w-full sm:w-auto">
              {query.isFetching ? (
                <Loader2 className="animate-spin" />
              ) : (
                <RefreshCw />
              )}
              Оновити
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="w-full sm:w-auto"
              disabled={!report}
              onClick={() => {
                if (!report) return;
                downloadReportXls(report);
                toast.success("Файл Excel збережено");
              }}
            >
              <Download />
              Excel
            </Button>
          </form>

          {loadingFutures ? (
            <p className="text-xs text-muted-foreground animate-pulse">
              Spot уже на екрані · асинхронно тягнемо Day / Week / Month…
            </p>
          ) : null}

          {/* Розріз: Дні / Декади */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Розріз звіту
            </span>
            <div className="flex rounded-full border border-border p-0.5">
              <button
                type="button"
                onClick={() => setViewMode("days")}
                className={cn(
                  "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                  viewMode === "days"
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Дні
              </button>
              <button
                type="button"
                onClick={() => setViewMode("decades")}
                className={cn(
                  "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                  viewMode === "decades"
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Декади
              </button>
            </div>
            <span className="text-xs text-muted-foreground">
              {viewMode === "days"
                ? "Подобові ціни Spot / Day / Week / Month і дельти"
                : "Середні за декаду + Δ + знижки −30/−20/−10% у € і ₴"}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        {query.isError ? (
          <Card>
            <CardContent className="flex items-start gap-3 py-5">
              <TriangleAlert className="mt-0.5 size-5 text-loss" />
              <div>
                <p className="font-medium">Не вдалося завантажити ринок</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {query.error instanceof Error
                    ? query.error.message
                    : "Спробуйте інший період."}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-3">
          <Kpi
            label="Середня Δ day"
            value={stats ? formatPrice(stats.avg) : null}
            hint="ф’ючерс − спот"
            loading={query.isLoading}
          />
          <Kpi
            label="Макс. відхилення"
            value={stats ? formatPrice(stats.absMax) : null}
            hint={zoneMeta.name}
            loading={query.isLoading}
          />
          <Kpi
            label="Покриття"
            value={
              stats
                ? `${stats.dayCount}/${stats.n} day · ${stats.spotCount}/${stats.n} spot`
                : null
            }
            hint={report ? `станом на ${new Date(report.fetchedAt).toLocaleString("uk-UA")}` : ""}
            loading={query.isLoading}
          />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Зона</CardTitle>
            <CardDescription>
              Подобові контракти є у DE, AT, FR, CZ, HU. SK, RO, PL, BG — лише місяць.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {ZONES.map((z) => (
                <button
                  key={z.id}
                  type="button"
                  onClick={() => setZone(z.id)}
                  className={cn(
                    "h-11 min-w-11 rounded-full border px-3.5 text-sm font-medium transition-colors duration-[var(--motion-quick)]",
                    zone === z.id
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {z.id}
                  {!z.dayPrefix ? (
                    <span className="ml-1 text-[10px] opacity-60">M</span>
                  ) : null}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-end justify-between gap-3">
            <div>
              <CardTitle>
                {zoneMeta.name}
                <span className="ml-2 font-sans text-sm font-normal text-muted-foreground">
                  {zoneMeta.short}
                </span>
              </CardTitle>
              <CardDescription>
                {zoneMeta.dayPrefix
                  ? `Day ${zoneMeta.dayPrefix}01… · Week ${zoneMeta.weekCode ?? "—"} · Month ${zoneMeta.monthCode}`
                  : `Немає day · Month ${zoneMeta.monthCode}`}
              </CardDescription>
            </div>
            {stats?.avg !== null && stats ? (
              <Badge variant={stats.avg > 0 ? "up" : stats.avg < 0 ? "down" : "default"}>
                {formatPct(
                  report
                    ? average(
                        report.dates
                          .map((d) => report.rows[d]?.[zone]?.dayDeltaPct)
                          .filter((v): v is number => v !== null && v !== undefined),
                      )
                    : null,
                )}
              </Badge>
            ) : null}
          </CardHeader>
          <CardContent>
            {query.isLoading ? (
              <Skeleton className="h-[280px] w-full rounded-[calc(var(--radius-xl)-8px)]" />
            ) : report ? (
              <DeltaChart report={report} zone={zone} />
            ) : (
              <p className="text-sm text-muted-foreground">Немає даних для графіка.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Усі зони · Spot + UA</CardTitle>
            <CardDescription>
              Подобові spot-ціни по країнах, середня EU та UA РДН (€). Увімкни/вимкни серії кнопками.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {query.isLoading ? (
              <Skeleton className="h-[300px] w-full rounded-[calc(var(--radius-xl)-8px)]" />
            ) : report ? (
              <OverviewChart report={report} />
            ) : (
              <p className="text-sm text-muted-foreground">Немає даних.</p>
            )}
          </CardContent>
        </Card>

        {viewMode === "days" ? (
        <Card>
          <CardHeader>
            <CardTitle>По днях</CardTitle>
            <CardDescription>
              Формат подобово (як у початковому звіті): Spot · Day-архів (до поставки) · Week · Weekend · Month · дельти.
              Day ніколи не підміняється Spot у день поставки.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {query.isLoading ? (
              <div className="grid gap-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-64 w-full" />
              </div>
            ) : report ? (
              <Tabs defaultValue="dayDeltaEur">
                <div className="overflow-x-auto">
                  <TabsList>
                    <TabsTrigger value="spot">Spot</TabsTrigger>
                    <TabsTrigger value="dayFutures">Day</TabsTrigger>
                    <TabsTrigger value="weekFutures">Week</TabsTrigger>
                    <TabsTrigger value="weekendFutures">Weekend</TabsTrigger>
                    <TabsTrigger value="monthFutures">Month</TabsTrigger>
                    <TabsTrigger value="dayDeltaEur">Δ day €</TabsTrigger>
                    <TabsTrigger value="dayDeltaPct">Δ day %</TabsTrigger>
                    <TabsTrigger value="monthDeltaEur">Δ month €</TabsTrigger>
                    <TabsTrigger value="euUa">EU + UA</TabsTrigger>
                  </TabsList>
                </div>
                <TabsContent value="spot">
                  <PriceTable report={report} metric="spot" highlight={zone} />
                </TabsContent>
                <TabsContent value="dayFutures">
                  <PriceTable report={report} metric="dayFutures" highlight={zone} />
                </TabsContent>
                <TabsContent value="weekFutures">
                  <PriceTable report={report} metric="weekFutures" highlight={zone} />
                </TabsContent>
                <TabsContent value="weekendFutures">
                  <PriceTable report={report} metric="weekendFutures" highlight={zone} />
                </TabsContent>
                <TabsContent value="monthFutures">
                  <PriceTable report={report} metric="monthFutures" highlight={zone} />
                </TabsContent>
                <TabsContent value="dayDeltaEur">
                  <PriceTable report={report} metric="dayDeltaEur" highlight={zone} />
                </TabsContent>
                <TabsContent value="dayDeltaPct">
                  <PriceTable report={report} metric="dayDeltaPct" highlight={zone} />
                </TabsContent>
                <TabsContent value="monthDeltaEur">
                  <PriceTable report={report} metric="monthDeltaEur" highlight={zone} />
                </TabsContent>
                <TabsContent value="euUa">
                  <EuUaTable report={report} />
                </TabsContent>
              </Tabs>
            ) : null}
          </CardContent>
        </Card>

        
        ) : (
        <Card>
          <CardHeader>
            <CardTitle>Декади</CardTitle>
            <CardDescription>
              Інший формат: середні за декаду (1–10 / 11–20 / 21–кінець) — SPOT, DAY, WEEK, WEEKEND,
              дельти €/% і ціни зі знижкою −30% / −20% / −10% у € та ₴.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {query.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : report ? (
              <DecadeTable report={report} />
            ) : null}
          </CardContent>
        </Card>
        )}

        {report?.warnings.length ? (
          <Card>
            <CardContent className="flex flex-col gap-2 py-5 text-sm text-muted-foreground">
              {report.warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <footer className="flex flex-col gap-2 pb-8 text-xs leading-relaxed text-muted-foreground">
          <Separator />
          <p className="flex items-center gap-2 pt-3">
            <Zap className="size-3.5" />
            Джерела: {report?.sources.eex ?? "EEX"} · {report?.sources.spot ?? "Energy-Charts"} · {report?.sources.ua ?? "UA РДН"}
          </p>
          <p className="flex items-center gap-2">
            <Activity className="size-3.5" />
            Подобовий shortCode — префікс зони + день місяця (DB05, AB05, F705). Місячний код
            не підходить для day-контрактів.
          </p>
        </footer>
      </main>
    </div>
  );
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

function Kpi({
  label,
  value,
  hint,
  loading,
}: {
  label: string;
  value: string | null;
  hint: string;
  loading: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 py-5">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </p>
        {loading ? (
          <Skeleton className="h-8 w-32" />
        ) : (
          <p className="font-display text-2xl tabular-nums tracking-tight">{value ?? "—"}</p>
        )}
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}
