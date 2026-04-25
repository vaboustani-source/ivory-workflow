import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

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
