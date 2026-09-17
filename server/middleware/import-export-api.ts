/**
 * Nitro middleware: GET /api/import-export?d1=&d2=&refresh=1
 */
import { buildSnapshot, loadAllDirections } from "../lib/sheets-ie.mjs";

interface ApiEvent {
  url: URL;
  req: { method: string; headers: Headers };
}

export default async function importExportApiMiddleware(
  event: ApiEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const method = (event.req.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "OPTIONS") return next();

  const path = event.url.pathname.replace(/\/$/, "") || "/";
  if (path !== "/api/import-export") return next();

  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
    });
  }

  const d1 = event.url.searchParams.get("d1") || undefined;
  const d2 = event.url.searchParams.get("d2") || undefined;
  const refresh = event.url.searchParams.get("refresh") === "1";

  try {
    if (refresh) await loadAllDirections(true);
    const data = await buildSnapshot(d1, d2);
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=60",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    console.error("[api/import-export]", e);
    return new Response(
      JSON.stringify({
        error: String(e instanceof Error ? e.message : e),
        meta: { directions: [], available_dates: [] },
      }),
      {
        status: 502,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      },
    );
  }
}
