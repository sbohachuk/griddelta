/** Import/export data loader — snapshot from Google Sheets (public/import-export-data.json). */

export type Delta = { abs?: number | null; pct?: number | null };

export type CompareItem = {
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
  // legacy simplified fields (fallback)
  oc?: number | null;
  rps?: number | null;
  price?: number | null;
  coverage?: number | null;
};

export type IEData = {
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
  compare: Record<string, CompareItem>;
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
  hourly: {
    d1?: Record<string, unknown>;
    d2?: Record<string, unknown>;
  };
  winners_cmp: Array<{
    company: string;
    v1?: number;
    v2?: number;
    vol?: number;
    d?: Delta;
  }>;
};

export async function loadImportExportData(): Promise<IEData> {
  const res = await fetch("/import-export-data.json", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(
      `Не вдалося завантажити import-export-data.json (HTTP ${res.status}). ` +
        `Поклади знімок у public/import-export-data.json`,
    );
  }
  const data = (await res.json()) as IEData;
  if (!data?.meta?.directions?.length) {
    throw new Error("JSON знімок порожній або без meta.directions");
  }
  return data;
}
