import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth/callback")({
  validateSearch: (s: Record<string, unknown>) => ({
    side: s.side === "portal" ? "portal" : "studio",
  }),
  component: OAuthCallback,
});

function OAuthCallback() {
  const { side } = useSearch({ from: "/auth/callback" });
  const navigate = useNavigate();
  const [denied, setDenied] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      // Wait briefly for supabase-js to consume the hash and persist the session.
      for (let i = 0; i < 30; i++) {
        const { data } = await supabase.auth.getSession();
        if (data.session) break;
        await new Promise((r) => setTimeout(r, 100));
      }

      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        if (!cancelled) setDenied("We couldn't complete sign-in. Please try again.");
        return;
      }

      const { data, error } = await supabase.rpc("resolve_oauth_login");
      if (cancelled) return;
      if (error) {
        await supabase.auth.signOut();
        setDenied("Sign-in failed. Please try again or contact the studio.");
        return;
      }
      const result = data as { status: string; side?: string; reason?: string };
      if (result?.status !== "allow") {
        await supabase.auth.signOut();
        setDenied(
          "This Google account isn't recognized. Please use the email the studio invited you with, or contact the studio at hello@victoriaboustani.com.",
        );
        return;
      }
      // route based on resolved side, falling back to URL hint
      const dest = (result.side ?? side) === "portal" ? "/portal" : "/studio";
      window.location.replace(dest);
    };
    run();
    return () => { cancelled = true; };
  }, [side]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        {!denied ? (
          <p className="font-serif italic text-2xl text-primary">Signing you in…</p>
        ) : (
          <>
            <h1 className="font-serif italic text-2xl text-primary">We couldn't sign you in.</h1>
            <p className="mt-3 text-sm text-muted-foreground">{denied}</p>
            <a
              href="/login"
              className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Back to sign in
            </a>
          </>
        )}
      </div>
    </div>
  );
}
