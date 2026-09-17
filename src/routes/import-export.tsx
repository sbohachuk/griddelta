import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/import-export")({
  ssr: false,
  component: ImportExportPage,
});

function ImportExportPage() {
  return (
    <iframe
      title="Імпорт / Експорт"
      src="/import-export.html"
      style={{
        border: "none",
        width: "100%",
        height: "100dvh",
        display: "block",
        background: "#0b1220",
      }}
    />
  );
}
