import { createFileRoute, useSearch, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const PUBLIC_PORTAL_URL = "https://project--e3bb35b0-f740-4259-80fa-567ec5c67321.lovable.app/portal";

function getPortalRedirectUrl() {
  if (typeof window === "undefined") return PUBLIC_PORTAL_URL;
  const { origin, hostname } = window.location;
  const isEditorPreview = hostname.endsWith(".lovableproject.com") || hostname.startsWith("id-preview--");
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";
  return isEditorPreview || isLocalhost ? PUBLIC_PORTAL_URL : `${origin}/portal`;
}

export const Route = createFileRoute("/portal/welcome")({
  validateSearch: (s: Record<string, unknown>) => ({ token: typeof s.token === "string" ? s.token : "" }),
  component: PortalWelcome,
});

type InviteState =
  | { status: "loading" }
  | { status: "valid"; invite: any; client: any; alreadyHasAccount: boolean }
  | { status: "expired" }
  | { status: "used" }
  | { status: "missing" };

function PortalWelcome() {
  const { token } = useSearch({ from: "/portal/welcome" });
  const navigate = useNavigate();
  const [state, setState] = useState<InviteState>({ status: "loading" });
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [loginMode, setLoginMode] = useState<"shared" | "separate">("shared");
  const [partnerEmail, setPartnerEmail] = useState("");
  const [authMethod, setAuthMethod] = useState<"magic" | "password">("magic");
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");

  useEffect(() => {
    if (!token) {
      setState({ status: "missing" });
      return;
    }
    (async () => {
      const { data: invite } = await supabase
        .from("portal_invitations")
        .select("id, client_id, invited_email, expires_at, used_at, invitation_type")
        .eq("invitation_token", token)
        .maybeSingle();

      if (!invite) { setState({ status: "missing" }); return; }
      if (invite.used_at) { setState({ status: "used" }); return; }
      if (new Date(invite.expires_at) < new Date()) { setState({ status: "expired" }); return; }

      const { data: client } = await supabase
        .from("clients")
        .select("id, couple_name_1, couple_name_2, primary_email, secondary_email")
        .eq("id", invite.client_id)
        .maybeSingle();

      // Check if a profile already exists for this email
      const { data: existing } = await supabase
        .from("profiles").select("id").eq("email", invite.invited_email).maybeSingle();

      setState({
        status: "valid",
        invite,
        client,
        alreadyHasAccount: !!existing,
      });
    })();
  }, [token]);

  const handleSubmit = async () => {
    if (state.status !== "valid") return;
    setSubmitting(true);
    try {
      const { invite, client } = state;
      const email = invite.invited_email as string;

      if (state.alreadyHasAccount) {
        // Send magic link to sign in
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: getPortalRedirectUrl() },
        });
        if (error) throw error;
        toast.success("Check your email for a sign-in link.");
        return;
      }

      if (authMethod === "password") {
        if (!password || password.length < 8) throw new Error("Password must be at least 8 characters.");
        if (password !== confirmPw) throw new Error("Passwords don't match.");
        const { data: signupData, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: getPortalRedirectUrl(),
            data: { full_name: invite.invitation_type === "partner" ? (client.couple_name_2 ?? email) : client.couple_name_1, role: "client" },
          },
        });
        if (error) throw error;

        // Sign in immediately
        const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
        if (signInErr) throw signInErr;

        await finalize(invite.id, client.id, signupData.user?.id ?? null, loginMode, partnerEmail.trim());
        navigate({ to: "/portal" });
      } else {
        // Magic link path: create user via signUp without password (passwordless)
        const tempPw = crypto.randomUUID() + "Aa1!";
        const { data: signupData, error } = await supabase.auth.signUp({
          email,
          password: tempPw,
          options: {
            emailRedirectTo: getPortalRedirectUrl(),
            data: { full_name: invite.invitation_type === "partner" ? (client.couple_name_2 ?? email) : client.couple_name_1, role: "client" },
          },
        });
        if (error && !String(error.message).toLowerCase().includes("already")) throw error;

        // Sign in with magic link
        await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: getPortalRedirectUrl() },
        });

        await finalize(invite.id, client.id, signupData?.user?.id ?? null, loginMode, partnerEmail.trim());
        toast.success("Check your email for a sign-in link to complete setup.");
        setState({ status: "used" });
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  const finalize = async (inviteId: string, clientId: string, userId: string | null, mode: "shared" | "separate", partner: string) => {
    // Mark invite used
    await supabase.from("portal_invitations").update({ used_at: new Date().toISOString() }).eq("id", inviteId);
    // Update client portal mode + first login
    if (state.status === "valid" && state.invite.invitation_type !== "partner") {
      await supabase.from("clients").update({
        portal_login_mode: mode,
        portal_first_login_at: new Date().toISOString(),
      }).eq("id", clientId);
    }
    // Insert client_users link if we have a user id
    if (userId) {
      await supabase.from("client_users").upsert({
        client_id: clientId,
        user_id: userId,
        role_in_couple: state.status === "valid" && state.invite.invitation_type === "partner" ? "partner_2" : "partner_1",
      }, { onConflict: "user_id,client_id" as any });
    }
    // If "Together", trigger partner invite
    if (mode === "separate" && partner) {
      try {
        await supabase.functions.invoke("send-portal-invite", {
          body: { client_id: clientId, invitation_type: "partner", invited_email: partner },
        });
      } catch (e) {
        console.warn("partner invite failed", e);
      }
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-[480px] bg-surface rounded-lg shadow-elevated p-8 md:p-10 border-t-2 border-gold">
        <div className="text-center mb-6">
          <div className="font-serif italic text-3xl text-gold tracking-wide">SBV</div>
        </div>

        {state.status === "loading" && <p className="font-serif italic text-center text-primary">Just a moment…</p>}
        {state.status === "missing" && (
          <>
            <h1 className="font-serif italic text-2xl text-primary text-center">No invitation found.</h1>
            <p className="text-sm text-muted-foreground text-center mt-3">
              The link you followed doesn't include an invitation. Please use the link from your email.
            </p>
          </>
        )}
        {state.status === "expired" && (
          <>
            <h1 className="font-serif italic text-2xl text-primary text-center">This invitation has expired.</h1>
            <p className="text-sm text-muted-foreground text-center mt-3">
              Please reach out to us at <a className="text-primary underline" href="mailto:hello@victoriaboustani.com">hello@victoriaboustani.com</a> or wait for a new invitation.
            </p>
          </>
        )}
        {state.status === "used" && (
          <>
            <h1 className="font-serif italic text-2xl text-primary text-center">Welcome back.</h1>
            <p className="text-sm text-muted-foreground text-center mt-3">
              This invitation has already been used. <a className="text-primary underline" href="/login">Sign in here</a>.
            </p>
          </>
        )}

        {state.status === "valid" && (
          <>
            <h1 className="font-serif italic text-2xl text-primary text-center">
              {state.invite.invitation_type === "partner"
                ? `Welcome to ${state.client.couple_name_1}${state.client.couple_name_2 ? ` & ${state.client.couple_name_2}` : ""}'s wedding portal.`
                : `Welcome, ${state.client.couple_name_1}.`}
            </h1>

            {state.alreadyHasAccount ? (
              <>
                <p className="text-sm text-foreground text-center mt-4">Click below to enter your portal.</p>
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="w-full mt-6 bg-primary text-primary-foreground py-2.5 rounded-md text-sm hover:bg-primary/90 disabled:opacity-50"
                >
                  {submitting ? "Sending…" : "Open my portal"}
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-foreground text-center mt-4">
                  We've prepared a space for you to walk through your wedding photography journey with us.
                </p>

                {state.invite.invitation_type !== "partner" && (
                  <div className="mt-6">
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">How would you like to log in?</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setLoginMode("shared")}
                        className={`p-3 rounded-md border text-left transition-colors ${loginMode === "shared" ? "border-primary bg-background-alt" : "border-border hover:border-gold"}`}
                      >
                        <p className="text-sm text-foreground font-medium">Just me</p>
                        <p className="text-[11px] text-muted-foreground mt-1">{state.client.couple_name_1} only.</p>
                      </button>
                      <button
                        onClick={() => setLoginMode("separate")}
                        className={`p-3 rounded-md border text-left transition-colors ${loginMode === "separate" ? "border-primary bg-background-alt" : "border-border hover:border-gold"}`}
                      >
                        <p className="text-sm text-foreground font-medium">Together</p>
                        <p className="text-[11px] text-muted-foreground mt-1">Both partners get separate logins.</p>
                      </button>
                    </div>
                    {loginMode === "separate" && (
                      <input
                        type="email"
                        value={partnerEmail}
                        onChange={(e) => setPartnerEmail(e.target.value)}
                        placeholder={`${state.client.couple_name_2 ?? "Partner"}'s email`}
                        className="w-full mt-3 px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    )}
                  </div>
                )}

                <div className="mt-6">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">How would you like to access your portal?</p>
                  <label className="flex items-start gap-2 p-2 cursor-pointer">
                    <input type="radio" checked={authMethod === "magic"} onChange={() => setAuthMethod("magic")} className="mt-1" />
                    <div>
                      <p className="text-sm text-foreground">Email me a sign-in link each time</p>
                      <p className="text-[11px] text-muted-foreground">Recommended — no password to remember.</p>
                    </div>
                  </label>
                  <label className="flex items-start gap-2 p-2 cursor-pointer">
                    <input type="radio" checked={authMethod === "password"} onChange={() => setAuthMethod("password")} className="mt-1" />
                    <div>
                      <p className="text-sm text-foreground">Set a password</p>
                    </div>
                  </label>
                  {authMethod === "password" && (
                    <div className="mt-2 space-y-2">
                      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (min 8 chars)" className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
                      <input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} placeholder="Confirm password" className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
                    </div>
                  )}
                </div>

                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="w-full mt-6 bg-primary text-primary-foreground py-2.5 rounded-md text-sm hover:bg-primary/90 disabled:opacity-50"
                >
                  {submitting ? "Setting up…" : "Open my portal"}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
