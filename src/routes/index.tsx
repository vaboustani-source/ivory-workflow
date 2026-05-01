import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { loading, profile } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!profile) {
      navigate({ to: "/login" });
    } else if (profile.role === "client") {
      navigate({ to: "/portal" });
    } else if (profile.role === "studio_manager") {
      navigate({ to: "/studio/queue" });
    } else {
      navigate({ to: "/studio" });
    }
  }, [loading, profile, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <p className="font-serif text-2xl italic text-primary">Loading…</p>
    </div>
  );
}
