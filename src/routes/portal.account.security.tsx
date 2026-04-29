import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

const STABLE_PORTAL_URL = "https://project--e3bb35b0-f740-4259-80fa-567ec5c67321-dev.lovable.app/portal";

function getPortalRedirectUrl() {
  if (typeof window === "undefined") return STABLE_PORTAL_URL;
  const { origin, hostname } = window.location;
  const isEditorPreview = hostname.endsWith(".lovableproject.com") || hostname.startsWith("id-preview--");
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";
  return isEditorPreview || isLocalhost ? STABLE_PORTAL_URL : `${origin}/portal`;
}

export const Route = createFileRoute("/portal/account/security")({
  component: SecuritySection,
});

function SecuritySection() {
  const { profile, session } = useAuth();
  const [showPwForm, setShowPwForm] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const setNewPassword = async () => {
    if (password.length < 8) return toast.error("Password must be at least 8 characters.");
    if (password !== confirm) return toast.error("Passwords don't match.");
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) toast.error(error.message);
    else {
      toast.success("Password set.");
      setShowPwForm(false);
      setPassword(""); setConfirm("");
    }
    setSaving(false);
  };

  const sendMagicLink = async () => {
    if (!profile?.email) return;
    const { error } = await supabase.auth.signInWithOtp({
      email: profile.email,
      options: { emailRedirectTo: getPortalRedirectUrl() },
    });
    if (error) toast.error(error.message);
    else toast.success("Sign-in link sent to your email.");
  };

  return (
    <div>
      <h1 className="font-serif italic text-[24px] text-primary mb-6">Login & security</h1>
      <div className="bg-surface rounded-lg shadow-soft p-6 border-t-2 border-gold space-y-6">
        <div>
          <p className="text-sm text-foreground">You're signed in as <span className="font-medium">{profile?.email}</span>.</p>
          {session?.user?.last_sign_in_at && (
            <p className="text-xs text-muted-foreground mt-1">Last sign-in: {new Date(session.user.last_sign_in_at).toLocaleString()}</p>
          )}
        </div>

        <div className="border-t border-border pt-4">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Set or change password</p>
          {!showPwForm ? (
            <button onClick={() => setShowPwForm(true)} className="border border-gold text-gold px-4 py-1.5 rounded-md text-sm hover:bg-gold/10">
              Set up a password
            </button>
          ) : (
            <div className="space-y-2 max-w-sm">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password" className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm password" className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
              <div className="flex gap-2">
                <button onClick={setNewPassword} disabled={saving} className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90 disabled:opacity-50">{saving ? "Saving…" : "Save password"}</button>
                <button onClick={() => setShowPwForm(false)} className="text-sm text-muted-foreground hover:text-primary">Cancel</button>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-border pt-4">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Magic link</p>
          <p className="text-sm text-foreground mb-2">Prefer email links instead of a password? We'll email you a one-time link.</p>
          <button onClick={sendMagicLink} className="border border-gold text-gold px-4 py-1.5 rounded-md text-sm hover:bg-gold/10">
            Email me a sign-in link
          </button>
        </div>
      </div>
    </div>
  );
}
