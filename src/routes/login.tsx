import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

async function signInWithGoogle(side: "studio" | "portal") {
  const redirectTo = `${window.location.origin}/auth/callback?side=${side}`;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, queryParams: { prompt: "select_account" } },
  });
  if (error) toast.error(error.message);
}

function GoogleButton({ side, label }: { side: "studio" | "portal"; label: string }) {
  return (
    <button
      type="button"
      onClick={() => signInWithGoogle(side)}
      className="w-full flex items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground hover:bg-surface transition-colors"
    >
      <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/>
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
        <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.3 5.3C41.4 36.2 44 30.6 44 24c0-1.3-.1-2.3-.4-3.5z"/>
      </svg>
      {label}
    </button>
  );
}

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const { signInWithMagicLink, signInWithPassword, profile, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (profile) {
      navigate({ to: profile.role === "client" ? "/portal" : "/studio" });
    }
  }, [loading, profile, navigate]);

  const handleMagicLink = async (e: FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setSubmitting(true);
    const { error } = await signInWithMagicLink(email);
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
    } else {
      setMagicLinkSent(true);
      toast.success("Sign-in link sent. Check your inbox.");
    }
  };

  const handlePassword = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await signInWithPassword(email, password);
    setSubmitting(false);
    if (error) toast.error(error.message);
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-primary px-4 py-10">
      <div className="w-full max-w-md rounded-lg bg-background shadow-[0_30px_80px_-20px_rgba(0,0,0,0.4)] p-10">
        <div className="text-center mb-8">
          <p className="text-[10px] tracking-[0.3em] text-gold uppercase mb-3">Stories by Victoria</p>
          <h1 className="font-serif italic text-3xl text-primary">Welcome back.</h1>
          <p className="mt-2 text-sm text-muted-foreground font-sans">
            Sign in to your studio.
          </p>
        </div>

        {magicLinkSent ? (
          <div className="text-center space-y-4">
            <p className="font-serif italic text-lg text-primary">A link is on its way.</p>
            <p className="text-sm text-muted-foreground">
              We sent a sign-in link to <span className="font-medium text-foreground">{email}</span>.
            </p>
            <button
              onClick={() => setMagicLinkSent(false)}
              className="text-xs text-primary underline underline-offset-4"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-3 mb-5">
              <GoogleButton side="studio" label="Sign in with Google" />
              <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                <span>or</span>
                <div className="h-px flex-1 bg-border" />
              </div>
            </div>

            <form onSubmit={handleMagicLink} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-sm border border-border bg-surface px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="you@example.com"
                />
              </div>

              {!showPassword && (
                <button
                  type="submit"
                  disabled={submitting || !email}
                  className="w-full rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {submitting ? "Sending…" : "Email me a sign-in link"}
                </button>
              )}
            </form>

            {!showPassword ? (
              <button
                onClick={() => setShowPassword(true)}
                className="mt-4 w-full text-center text-xs text-muted-foreground hover:text-primary underline underline-offset-4"
              >
                Use a password instead
              </button>
            ) : (
              <form onSubmit={handlePassword} className="mt-4 space-y-4">
                <div>
                  <label htmlFor="password" className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-sm border border-border bg-surface px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {submitting ? "Signing in…" : "Sign in"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowPassword(false)}
                  className="w-full text-center text-xs text-muted-foreground hover:text-primary underline underline-offset-4"
                >
                  Use a magic link instead
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
