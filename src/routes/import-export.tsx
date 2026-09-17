import { createFileRoute } from "@tanstack/react-router";
import ImportExportPage from "@/components/ImportExportPage";

export const Route = createFileRoute("/import-export")({
  ssr: false,
  component: ImportExportPage,
});
