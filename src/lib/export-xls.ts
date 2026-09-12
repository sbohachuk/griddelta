import { ZONES, type ZoneId } from "./zones";
import type { MarketReport } from "./market-types";

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&" + "amp;")
    .replace(/</g, "&" + "lt;")
    .replace(/>/g, "&" + "gt;")
    .replace(/"/g, "&" + "quot;");
}

function cellStr(value: string, style?: string): string {
  const s = style ? ` ss:StyleID="${style}"` : "";
  return `<Cell${s}><Data ss:Type="String">${xmlEscape(value)}</Data></Cell>`;
}

function cellNum(value: number | null, style?: string): string {
  if (value === null || Number.isNaN(value)) return cellStr("—", style);
  const s = style ? ` ss:StyleID="${style}"` : ' ss:StyleID="num"';
  return `<Cell${s}><Data ss:Type="Number">${value}</Data></Cell>`;
}

function deltaStyle(value: number | null): string | undefined {
  if (value === null) return undefined;
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "num";
}

function sheet(
  name: string,
  title: string,
  report: MarketReport,
  pick: (zone: ZoneId, date: string) => number | null,
  isDelta = false,
): string {
  const zones = ZONES.filter((z) => report.zones.includes(z.id));
  const header = [cellStr("Дата", "header"), ...zones.map((z) => cellStr(z.id, "header"))].join(
    "",
  );
  const body = report.dates
    .map((date) => {
      const cells = [
        cellStr(date, "date"),
        ...zones.map((z) => {
          const v = pick(z.id, date);
          return cellNum(v, isDelta ? deltaStyle(v) : "num");
        }),
      ].join("");
      return `<Row>${cells}</Row>`;
    })
    .join("");
  return `
<Worksheet ss:Name="${xmlEscape(name)}">
  <Table>
    <Column ss:Width="80"/>
    ${zones.map(() => `<Column ss:Width="72"/>`).join("")}
    <Row><Cell ss:StyleID="title" ss:MergeAcross="${zones.length}"><Data ss:Type="String">${xmlEscape(title)}</Data></Cell></Row>
    <Row><Cell ss:StyleID="meta" ss:MergeAcross="${zones.length}"><Data ss:Type="String">${xmlEscape(`Період ${report.startDate} — ${report.endDate}`)}</Data></Cell></Row>
    <Row></Row>
    <Row>${header}</Row>
    ${body}
  </Table>
</Worksheet>`;
}

function euUaSheet(report: MarketReport): string {
  const header = [
    cellStr("Дата", "header"),
    cellStr("EU avg €", "header"),
    cellStr("UA РДН €", "header"),
    cellStr("UA РДН ₴", "header"),
    cellStr("Δ UA vs EU %", "header"),
    cellStr("EUR/UAH", "header"),
  ].join("");
  const body = (report.euUa ?? [])
    .map(
      (r) =>
        `<Row>${[
          cellStr(r.date, "date"),
          cellNum(r.euAvg),
          cellNum(r.uaRdnEur),
          cellNum(r.uaRdnUah),
          cellNum(r.deltaPct, deltaStyle(r.deltaPct)),
          cellNum(r.eurUah),
        ].join("")}</Row>`,
    )
    .join("");
  return `
<Worksheet ss:Name="EU + UA">
  <Table>
    <Column ss:Width="90"/>
    <Column ss:Width="80"/><Column ss:Width="80"/><Column ss:Width="80"/><Column ss:Width="100"/><Column ss:Width="80"/>
    <Row><Cell ss:StyleID="title" ss:MergeAcross="5"><Data ss:Type="String">Середня Європа + UA РДН (EUR) + відхилення %</Data></Cell></Row>
    <Row><Cell ss:StyleID="meta" ss:MergeAcross="5"><Data ss:Type="String">${xmlEscape(`Період ${report.startDate} — ${report.endDate}`)}</Data></Cell></Row>
    <Row></Row>
    <Row>${header}</Row>
    ${body}
  </Table>
</Worksheet>`;
}

function decadeSheet(report: MarketReport): string {
  const header = [
    cellStr("Декада", "header"),
    cellStr("SPOT €", "header"),
    cellStr("DAY €", "header"),
    cellStr("WEEK €", "header"),
    cellStr("WEEKEND €", "header"),
    cellStr("Δ DAY €", "header"),
    cellStr("Δ DAY %", "header"),
    cellStr("Δ WEEK €", "header"),
    cellStr("Δ WEEK %", "header"),
    cellStr("−30% €", "header"),
    cellStr("−20% €", "header"),
    cellStr("−10% €", "header"),
    cellStr("−30% ₴", "header"),
    cellStr("−20% ₴", "header"),
    cellStr("−10% ₴", "header"),
  ].join("");
  const body = (report.decades ?? [])
    .map(
      (d) =>
        `<Row>${[
          cellStr(d.label, "date"),
          cellNum(d.euAvgEur),
          cellNum(d.dayAvgEur),
          cellNum(d.weekAvgEur),
          cellNum(d.weekendAvgEur),
          cellNum(d.dayDeltaEur, deltaStyle(d.dayDeltaEur)),
          cellNum(d.dayDeltaPct, deltaStyle(d.dayDeltaPct)),
          cellNum(d.weekDeltaEur, deltaStyle(d.weekDeltaEur)),
          cellNum(d.weekDeltaPct, deltaStyle(d.weekDeltaPct)),
          cellNum(d.disc30Eur),
          cellNum(d.disc20Eur),
          cellNum(d.disc10Eur),
          cellNum(d.disc30Uah),
          cellNum(d.disc20Uah),
          cellNum(d.disc10Uah),
        ].join("")}</Row>`,
    )
    .join("");
  return `
<Worksheet ss:Name="Декади">
  <Table>
    <Column ss:Width="100"/>
    ${Array.from({ length: 14 })
      .map(() => `<Column ss:Width="72"/>`)
      .join("")}
    <Row><Cell ss:StyleID="title" ss:MergeAcross="14"><Data ss:Type="String">Декада: SPOT / DAY / WEEK / WEEKEND + дельти + знижки 30/20/10%</Data></Cell></Row>
    <Row><Cell ss:StyleID="meta" ss:MergeAcross="14"><Data ss:Type="String">${xmlEscape(`Період ${report.startDate} — ${report.endDate}`)}</Data></Cell></Row>
    <Row></Row>
    <Row>${header}</Row>
    ${body}
  </Table>
</Worksheet>`;
}

export function reportToSpreadsheet(report: MarketReport): string {
  const pick =
    (
      key:
        | "spot"
        | "dayFutures"
        | "weekFutures"
        | "weekendFutures"
        | "monthFutures"
        | "dayDeltaEur"
        | "dayDeltaPct"
        | "weekDeltaEur"
        | "weekendDeltaEur"
        | "monthDeltaEur",
    ) =>
    (zone: ZoneId, date: string) =>
      report.rows[date]?.[zone]?.[key] ?? null;

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="title"><Font ss:Bold="1" ss:Size="14" ss:Color="#1E293B"/></Style>
    <Style ss:ID="meta"><Font ss:Italic="1" ss:Color="#64748B"/></Style>
    <Style ss:ID="header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#1E293B" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center"/></Style>
    <Style ss:ID="date"><Alignment ss:Horizontal="Center"/><Font ss:Color="#0F172A"/></Style>
    <Style ss:ID="num"><NumberFormat ss:Format="0.00"/><Alignment ss:Horizontal="Right"/></Style>
    <Style ss:ID="up"><NumberFormat ss:Format="0.00"/><Interior ss:Color="#ECFDF5" ss:Pattern="Solid"/><Alignment ss:Horizontal="Right"/></Style>
    <Style ss:ID="down"><NumberFormat ss:Format="0.00"/><Interior ss:Color="#FEF2F2" ss:Pattern="Solid"/><Alignment ss:Horizontal="Right"/></Style>
  </Styles>
  ${sheet("SPOT", "SPOT ціни (Energy-Charts) — EUR/MWh", report, pick("spot"))}
  ${sheet("DAY FUTURES", "DAY FUTURES (архів ДО поставки) — EUR/MWh", report, pick("dayFutures"))}
  ${sheet("WEEK FUTURES", "WEEK FUTURES (EEX calendar Week YYYYWW) — EUR/MWh", report, pick("weekFutures"))}
  ${sheet("WEEKEND FUTURES", "WEEKEND FUTURES (EEX) — EUR/MWh", report, pick("weekendFutures"))}
  ${sheet("MONTH FUTURES", "MONTH FUTURES (EEX Base Month) — EUR/MWh", report, pick("monthFutures"))}
  ${sheet("DELTA DAY EUR", "DELTA DAY (EUR) — Day archive minus Spot", report, pick("dayDeltaEur"), true)}
  ${sheet("DELTA DAY %", "DELTA DAY (%) — Day archive vs Spot", report, pick("dayDeltaPct"), true)}
  ${sheet("DELTA WEEK EUR", "DELTA WEEK (EUR)", report, pick("weekDeltaEur"), true)}
  ${sheet("DELTA WEEKEND EUR", "DELTA WEEKEND (EUR)", report, pick("weekendDeltaEur"), true)}
  ${sheet("DELTA MONTH EUR", "DELTA MONTH (EUR)", report, pick("monthDeltaEur"), true)}
  ${euUaSheet(report)}
  ${decadeSheet(report)}
</Workbook>`;
}

export function downloadReportXls(report: MarketReport) {
  const xml = reportToSpreadsheet(report);
  const blob = new Blob([xml], { type: "application/vnd.ms-excel" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `eex_spot_delta_${report.startDate}_${report.endDate}.xls`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
