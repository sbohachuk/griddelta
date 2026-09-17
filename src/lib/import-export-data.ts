/** Snapshot of import/export data from Google Sheets (gzip+base64). */
export const IMPORT_EXPORT_DATA_B64_PARTS = [
  "PLACEHOLDER_PART0",
] as const;

export async function loadImportExportData(): Promise<unknown> {
  const b64 = IMPORT_EXPORT_DATA_B64_PARTS.join("");
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text());
}
