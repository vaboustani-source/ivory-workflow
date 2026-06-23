import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sendPortalInvitation } from "@/lib/portal-invite.functions";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/portal/account/partner")({
  component: PartnerSection,
});

function PartnerSection() {
  const { profile } = useAuth();
  const [client, setClient] = useState<any>(null);
  const [participants, setParticipants] = useState<Array<{ id: string; user_id: string; created_at: string; profile: any }>>([]);
  const [loaded, setLoaded] = useState(false);
  const [partnerEmail, setPartnerEmail] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!profile) return;
    (async () => {
      const { data: cu } = await supabase.from("client_users").select("client_id").eq("user_id", profile.id).limit(1).maybeSingle();
      if (!cu) { setLoaded(true); return; }
      const { data: c } = await supabase.from("clients").select("id, couple_name_1, couple_name_2, portal_login_mode").eq("id", cu.client_id).maybeSingle();
      const { data: ps } = await supabase
        .from("client_users")
        .select("id, user_id, created_at, profile:profiles!client_users_user_id_fkey(full_name, email, avatar_url)")
        .eq("client_id", cu.client_id);
      setClient(c);
      setParticipants((ps ?? []) as any);
      setLoaded(true);
    })();
  }, [profile?.id]);

  const sendInvite = async () => {
    if (!partnerEmail.trim() || !client) return;
    setSending(true);
    try {
      const result = await sendPortalInvitation({
        data: { client_id: client.id, invitation_type: "partner", invited_email: partnerEmail.trim() },
      });
      if (!result.ok) throw new Error(result.error ?? "send failed");
      toast.success("Invitation sent.");
      setPartnerEmail("");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't send invite.");
    } finally {
      setSending(false);
    }
  };

  const switchToSeparate = async () => {
    if (!client) return;
    const { error } = await supabase.from("clients").update({ portal_login_mode: "separate" }).eq("id", client.id);
    if (error) toast.error(error.message);
    else { toast.success("Switched. Invite your partner below."); setClient({ ...client, portal_login_mode: "separate" }); }
  };

  if (!loaded) return <p className="text-sm text-muted-foreground italic">Loading…</p>;
  if (!client) return null;

  if (client.portal_login_mode !== "shared" && client.portal_login_mode !== "separate") {
    return (
      <div>
        <h1 className="font-serif italic text-[24px] text-primary mb-6">Your partner</h1>
        <div className="bg-surface rounded-lg shadow-soft p-6 border-t-2 border-gold">
          <p className="text-sm text-foreground">You haven't set a portal login mode yet.</p>
        </div>
      </div>
    );
  }

  const others = participants.filter((p) => p.user_id !== profile?.id);

  return (
    <div>
      <h1 className="font-serif italic text-[24px] text-primary mb-6">Your partner</h1>
      <div className="bg-surface rounded-lg shadow-soft p-6 border-t-2 border-gold">
        {client.portal_login_mode === "shared" && (
          <>
            <p className="text-sm text-foreground">
              You and {client.couple_name_2 ?? "your partner"} currently share this login.
            </p>
            <button onClick={switchToSeparate} className="mt-4 border border-gold text-gold px-4 py-1.5 rounded-md text-sm hover:bg-gold/10">
              Switch to separate logins
            </button>
            <p className="text-[11px] text-muted-foreground italic mt-2">
              Each of you will get your own access while staying on the same wedding details. Recommended for couples who want their own space.
            </p>
          </>
        )}

        {client.portal_login_mode === "separate" && others.length > 0 && (
          <div className="space-y-3">
            {others.map((p) => (
              <div key={p.id} className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-full bg-plum text-background flex items-center justify-center font-serif italic">
                  {(p.profile?.full_name ?? "?").charAt(0).toUpperCase()}
                </div>
                <div className="flex-1">
                  <p className="font-serif italic text-base text-primary">{p.profile?.full_name ?? "Partner"}</p>
                  <p className="text-xs text-muted-foreground">{p.profile?.email}</p>
                  <p className="text-[11px] text-muted-foreground italic">Joined {new Date(p.created_at).toLocaleDateString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {client.portal_login_mode === "separate" && others.length === 0 && (
          <>
            <p className="font-serif italic text-lg text-primary">Invite {client.couple_name_2 ?? "your partner"}.</p>
            <p className="text-sm text-foreground mt-2">They'll get their own login. You'll both see the same wedding details.</p>
            <div className="mt-4 flex flex-col sm:flex-row gap-2">
              <input
                type="email"
                value={partnerEmail}
                onChange={(e) => setPartnerEmail(e.target.value)}
                placeholder="partner@example.com"
                className="flex-1 px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <button onClick={sendInvite} disabled={sending || !partnerEmail.trim()} className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90 disabled:opacity-50">
                {sending ? "Sending…" : "Send invite"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
