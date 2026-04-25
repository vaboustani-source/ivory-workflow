import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { StudioLayout } from "@/components/StudioLayout";
import { useAuth } from "@/lib/auth";
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/studio")({
  component: StudioGate,
});

function StudioGate() {
  const { loading, profile } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!profile) {
      navigate({ to: "/login" });
    } else if (profile.role === "client") {
      navigate({ to: "/portal" });
    }
  }, [loading, profile, navigate]);

  if (loading || !profile || profile.role === "client") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="font-serif italic text-xl text-primary">Loading…</p>
      </div>
    );
  }

  return (
    <StudioLayout>
      <Outlet />
    </StudioLayout>
  );
}
