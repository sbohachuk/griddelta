/**
 * Імпорт/Експорт — ідентичний UI з public/import-export-app.html
 * (повний дашборд: огляд, погодинка, 14 днів, контрагенти).
 * Дані: public/import-export-data.json
 */
export default function ImportExportPage() {
  return (
    <div className="min-h-dvh bg-[#0b1220]">
      <iframe
        title="GRIDDELTA — Імпорт / Експорт"
        src="/import-export-app.html"
        className="block h-dvh w-full border-0"
        style={{ minHeight: "100vh" }}
      />
    </div>
  );
}
