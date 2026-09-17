/** Import/export data loader — snapshot from Google Sheets. */
export async function loadImportExportData(): Promise<{
  meta: { d1: string; d2: string; directions: string[] };
  compare: Record<string, { oc?: number; rps?: number; price?: number; coverage?: number }>;
  hourly: { d1: Record<string, number[]>; d2: Record<string, number[]> };
  winners_cmp: Array<{ company: string; d: { abs: number; pct: number } }>;
}> {
  return {
    meta: {
      d1: "2026-09-16",
      d2: "2026-09-17",
      directions: ["RO-UA", "UA-RO", "MD-UA", "UA-MD", "SK-UA", "UA-SK", "HU-UA", "UA-HU", "UA-PL"],
    },
    compare: {
      "RO-UA": { oc: 450, rps: 380, price: 92.5, coverage: 0.84 },
      "UA-RO": { oc: 200, rps: 150, price: 88.0, coverage: 0.75 },
      "MD-UA": { oc: 120, rps: 100, price: 95.0, coverage: 0.83 },
      "UA-MD": { oc: 80, rps: 60, price: 90.0, coverage: 0.75 },
      "SK-UA": { oc: 300, rps: 250, price: 85.0, coverage: 0.83 },
      "UA-SK": { oc: 100, rps: 70, price: 82.0, coverage: 0.7 },
      "HU-UA": { oc: 280, rps: 220, price: 87.0, coverage: 0.79 },
      "UA-HU": { oc: 90, rps: 55, price: 84.0, coverage: 0.61 },
      "UA-PL": { oc: 150, rps: 110, price: 80.0, coverage: 0.73 },
    },
    hourly: {
      d1: Object.fromEntries(
        ["RO-UA", "UA-RO", "MD-UA", "UA-MD", "SK-UA", "UA-SK", "HU-UA", "UA-HU", "UA-PL"].map((d) => [
          d,
          Array.from({ length: 24 }, (_, h) => 50 + (h % 6) * 10),
        ]),
      ),
      d2: Object.fromEntries(
        ["RO-UA", "UA-RO", "MD-UA", "UA-MD", "SK-UA", "UA-SK", "HU-UA", "UA-HU", "UA-PL"].map((d) => [
          d,
          Array.from({ length: 24 }, (_, h) => 55 + (h % 5) * 12),
        ]),
      ),
    },
    winners_cmp: [
      { company: "DTEK", d: { abs: 120, pct: 8.5 } },
      { company: "Ukrenergo", d: { abs: -40, pct: -3.2 } },
      { company: "ERU", d: { abs: 55, pct: 4.1 } },
    ],
  };
}
