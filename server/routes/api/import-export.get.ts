/**
 * GET /api/import-export?d1=&d2=&refresh=1
 * Production (Nitro) handler — reuses shared parser.
 */
// @ts-expect-error resolved at build
import { buildSnapshot, loadAllDirections } from "../../../src/lib/import-export/sheets-live";

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
    throw createError({
      statusCode: 502,
      statusMessage: String(e instanceof Error ? e.message : e),
    });
  }
});
