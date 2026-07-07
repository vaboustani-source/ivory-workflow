import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/studio/settings/resources")({
  component: RedirectToResources,
});

function RedirectToResources() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/studio/resources" });
  }, [navigate]);
  return (
    <div className="min-h-[200px] flex items-center justify-center">
      <p className="font-serif italic text-xl text-primary">Redirecting…</p>
    </div>
  );
}
