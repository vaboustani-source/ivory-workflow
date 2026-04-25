import { createFileRoute } from "@tanstack/react-router";
import { ComingSoonPanel } from "@/components/ComingSoonPanel";

export const Route = createFileRoute("/studio/settings/resources")({
  component: () => <ComingSoonPanel />,
});
