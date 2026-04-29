import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/portal")({
  component: PortalRoot,
});

function PortalRoot() {
  return <Outlet />;
}
