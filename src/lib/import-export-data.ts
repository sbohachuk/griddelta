/** Import/export — live Google Sheets via /api/import-export */

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
};

export type IEData = {
  meta: {
    d1: string;
    d2: string;
    directions: string[];
    range?: string | string[];
    n_days?: number;
    available_dates?: string[];
    source?: string;
    fetched_at?: string;
  };
  flow?: {
    d1?: { imp_oc?: number; exp_oc?: number; imp_rps?: number; exp_rps?: number };
    d2?: { imp_oc?: number; exp_oc?: number; imp_rps?: number; exp_rps?: number };
    delta?: Record<string, Delta>;
  };
  compare: Record<string, CompareItem>;
  day_totals?: Array<Record<string, unknown>>;
  hourly: { d1?: Record<string, unknown>; d2?: Record<string, unknown> };
  winners_cmp: Array<{
    company: string;
    v1?: number;
    v2?: number;
    d?: Delta;
  }>;
};

export async function loadImportExportData(
  d1?: string,
  d2?: string,
  refresh = false,
): Promise<IEData> {
  const qs = new URLSearchParams();
  if (d1) qs.set("d1", d1);
  if (d2) qs.set("d2", d2);
  if (refresh) qs.set("refresh", "1");
  const res = await fetch("/api/import-export?" + qs.toString(), { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`API import-export HTTP ${res.status}`);
  }
  const data = (await res.json()) as IEData & { error?: string };
  if (data.error) throw new Error(data.error);
  if (!data?.meta?.directions?.length) {
    throw new Error("Порожня відповідь API");
  }
  return data;
}
