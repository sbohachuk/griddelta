/**
 * GET /api/import-export?d1=&d2=&refresh=1
 * Live data from Google Spreadsheet (server-side only).
 */
import { buildSnapshot, loadAllDirections } from "../../lib/sheets-ie";

export default defineEventHandler(async (event) => {
  const q = getQuery(event);
  const d1 = typeof q.d1 === "string" ? q.d1 : undefined;
  const d2 = typeof q.d2 === "string" ? q.d2 : undefined;
  const refresh = q.refresh === "1" || q.refresh === "true";

  setHeader(event, "Cache-Control", "public, max-age=60");
  setHeader(event, "Access-Control-Allow-Origin", "*");

  try {
    if (refresh) await loadAllDirections(true);
    return await buildSnapshot(d1, d2);
  } catch (e) {
    console.error("[api/import-export]", e);
    // return JSON body so UI can show message (not only unhandled 500)
    setResponseStatus(event, 502);
    return {
      error: String(e instanceof Error ? e.message : e),
      meta: { directions: [], available_dates: [] },
    };
  }
});
