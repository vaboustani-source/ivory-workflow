import { createFileRoute } from "@tanstack/react-router";
import { PortalGate } from "@/components/PortalLayout";
import { PortalPlaceholder } from "@/components/PortalPlaceholder";

export const Route = createFileRoute("/portal/engagement")({
  component: () => <PortalGate>{() => <PortalPlaceholder />}</PortalGate>,
});
