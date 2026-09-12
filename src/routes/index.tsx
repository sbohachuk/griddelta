import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "@/components/dashboard";

export const Route = createFileRoute("/")({
  ssr: false,
  component: Home,
});

function Home() {
  return <Dashboard />;
}
