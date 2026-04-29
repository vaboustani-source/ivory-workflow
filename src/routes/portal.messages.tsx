import { createFileRoute } from "@tanstack/react-router";
import { PortalGate } from "@/components/PortalLayout";
import { PortalPlaceholder } from "@/components/PortalPlaceholder";

export const Route = createFileRoute("/portal/messages")({
  component: () => <PortalGate>{() => <PortalPlaceholder />}</PortalGate>,
});
