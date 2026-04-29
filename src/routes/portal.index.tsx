import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PortalGate } from "@/components/PortalLayout";
import { shortDate, daysBetween, relativeTime } from "@/lib/dates";
import { toast } from "sonner";

export const Route = createFileRoute("/portal/")({
  component: PortalHomeRoute,
});

function PortalHomeRoute() {
  return <PortalGate>{({ client, clientId }) => <PortalHome client={client} clientId={clientId} />}</PortalGate>;
}

function PortalHome({ client, clientId }: { client: any; clientId: string }) {
  const [photographer, setPhotographer] = useState<{ full_name: string | null; avatar_url: string | null; email: string | null } | null>(null);
  const [activity, setActivity] = useState<Array<{ id: string; label: string; when: string; to?: string }>>([]);
  const [participantCount, setParticipantCount] = useState(0);
  const [partnerEmail, setPartnerEmail] = useState("");
  const [sendingPartner, setSendingPartner] = useState(false);
  const [partnerSent, setPartnerSent] = useState(false);
  const [whatsNext, setWhatsNext] = useState<{ label: string; to?: string; cta?: string; soft?: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const photogId = client.photographer_id ?? client.manager_id;
      if (photogId) {
        const { data: p } = await supabase
          .from("profiles")
          .select("full_name, avatar_url, email")
          .eq("id", photogId)
          .maybeSingle();
        if (!cancelled) setPhotographer(p);
      }

      // Recent activity: messages + milestones (client-visible only)
      const { data: msgs } = await supabase
        .from("messages")
        .select("id, content, created_at, sender:profiles!messages_sender_id_fkey(full_name)")
        .eq("is_internal_note", false)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(3);
      const { data: ms } = await supabase
        .from("timeline_milestones")
        .select("id, title, completed_at, created_at, status")
        .eq("client_id", clientId)
        .eq("is_client_visible", true)
        .order("created_at", { ascending: false })
        .limit(3);
      const items: Array<{ id: string; label: string; when: string; to?: string }> = [];
      (msgs ?? []).forEach((m: any) => items.push({
        id: m.id,
        label: `${m.sender?.full_name ?? "The studio"} sent you a message`,
        when: m.created_at,
        to: "/portal/messages",
      }));
      (ms ?? []).forEach((m: any) => items.push({
        id: m.id,
        label: m.status === "complete" ? `Completed: ${m.title}` : `Added to your timeline: ${m.title}`,
        when: m.completed_at ?? m.created_at,
        to: "/portal/timeline",
      }));
      items.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
      if (!cancelled) setActivity(items.slice(0, 5));

      // Count participants for partner-invite card
      const { count: pcount } = await supabase
        .from("client_users").select("id", { count: "exact", head: true }).eq("client_id", clientId);
      if (!cancelled) setParticipantCount(pcount ?? 0);

      // Determine "what's next"
      const next = await computeWhatsNext(clientId, client);
      if (!cancelled) setWhatsNext(next);
    };
    load();
    return () => { cancelled = true; };
  }, [clientId]);

  const days = daysBetween(client.wedding_date);
  const showPartnerCard =
    (client.portal_login_mode === "separate" || client.portal_login_mode === "pending") &&
    participantCount <= 1 && !partnerSent;

  const sendPartner = async () => {
    if (!partnerEmail.trim()) return;
    setSendingPartner(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-portal-invite", {
        body: { client_id: clientId, invitation_type: "partner", invited_email: partnerEmail.trim() },
      });
      if (error) throw error;
      setPartnerSent(true);
      toast.success("Invitation sent.");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't send invite.");
    } finally {
      setSendingPartner(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="bg-background-alt rounded-lg shadow-soft p-8 md:p-12 text-center">
        <h1 className="font-serif italic text-[28px] md:text-[36px] text-primary leading-tight">
          {client.couple_name_1}{client.couple_name_2 ? ` & ${client.couple_name_2}` : ""}
        </h1>
        {client.wedding_date ? (
          <>
            <div className="mx-auto my-4 h-px w-12 bg-gold" />
            <p className="text-sm text-foreground/80">
              {days !== null && days > 0 ? `${days} days until your wedding` : days === 0 ? "Today is the day." : `${shortDate(client.wedding_date)}`}
            </p>
          </>
        ) : (
          <p className="font-serif italic text-base text-primary/80 mt-3">We're excited to begin your story.</p>
        )}
      </div>

      {/* What's next */}
      <Card title="What's next">
        {whatsNext ? (
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <p className={`${whatsNext.soft ? "font-serif italic text-lg text-primary/80" : "text-foreground"}`}>
              {whatsNext.label}
            </p>
            {whatsNext.to && whatsNext.cta && (
              <Link
                to={whatsNext.to}
                className="inline-block bg-primary text-primary-foreground px-5 py-2 rounded-md text-sm hover:bg-primary/90 self-start md:self-auto"
              >
                {whatsNext.cta}
              </Link>
            )}
          </div>
        ) : (
          <p className="font-serif italic text-lg text-muted-foreground">
            All quiet for now. We'll let you know when something needs your attention.
          </p>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Photographer */}
        <Card title="Your photographer">
          <div className="flex gap-4">
            <div className="h-16 w-16 rounded-full bg-plum text-background flex items-center justify-center font-serif italic text-xl shrink-0 overflow-hidden">
              {photographer?.avatar_url
                ? <img src={photographer.avatar_url} alt="" className="h-full w-full object-cover" />
                : (photographer?.full_name ?? "V").charAt(0)}
            </div>
            <div>
              <p className="font-serif italic text-lg text-primary">{photographer?.full_name ?? "Victoria"}</p>
              <p className="text-sm text-foreground/80 mt-1">
                I tell wedding stories through unhurried, intentional photography.
              </p>
              <a href="mailto:hello@victoriaboustani.com" className="text-sm text-primary underline mt-2 inline-block">
                hello@victoriaboustani.com
              </a>
            </div>
          </div>
        </Card>

        {/* Partner invite */}
        {showPartnerCard && (
          <Card title="Invite your partner">
            <p className="font-serif italic text-lg text-primary">
              Bring {client.couple_name_2 ?? "your partner"} into your portal.
            </p>
            <p className="text-sm text-foreground/80 mt-2">
              They'll get their own login and stay in the loop on every detail.
            </p>
            <div className="mt-4 flex flex-col sm:flex-row gap-2">
              <input
                type="email"
                value={partnerEmail}
                onChange={(e) => setPartnerEmail(e.target.value)}
                placeholder="partner@example.com"
                className="flex-1 px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <button
                onClick={sendPartner}
                disabled={sendingPartner || !partnerEmail.trim()}
                className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90 disabled:opacity-50"
              >
                {sendingPartner ? "Sending…" : "Send invite"}
              </button>
            </div>
          </Card>
        )}
        {partnerSent && (
          <Card title="Invite your partner">
            <p className="font-serif italic text-lg text-primary">Invitation sent to {partnerEmail}.</p>
            <p className="text-sm text-muted-foreground mt-2">We'll notify you when they join.</p>
          </Card>
        )}
      </div>

      {/* Recent activity */}
      <Card title="Recent">
        {activity.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">Nothing recent yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {activity.map((a) => (
              <li key={a.id}>
                {a.to ? (
                  <Link to={a.to} className="block py-3 flex items-center justify-between hover:bg-background-alt/50 -mx-2 px-2 rounded-sm">
                    <span className="text-sm text-foreground">{a.label}</span>
                    <span className="text-xs text-muted-foreground">{relativeTime(a.when)}</span>
                  </Link>
                ) : (
                  <div className="py-3 flex items-center justify-between">
                    <span className="text-sm text-foreground">{a.label}</span>
                    <span className="text-xs text-muted-foreground">{relativeTime(a.when)}</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-lg shadow-soft p-6 border-t-2 border-gold">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-4">{title}</p>
      {children}
    </div>
  );
}

async function computeWhatsNext(clientId: string, client: any): Promise<{ label: string; to?: string; cta?: string; soft?: boolean } | null> {
  const status = client.status;
  // Booked/active priority order
  if (status === "booked" || status === "active") {
    const { data: contracts } = await supabase
      .from("contracts").select("id, status").eq("client_id", clientId);
    const unsigned = (contracts ?? []).find((c: any) => c.status !== "signed");
    if (unsigned) return { label: "Your contract is ready to sign.", to: "/portal/documents", cta: "View contract" };

    const { data: invs } = await supabase
      .from("invoices").select("id, status, invoice_type").eq("client_id", clientId);
    const unpaidRetainer = (invs ?? []).find((i: any) => i.invoice_type === "retainer" && i.status !== "paid");
    if (unpaidRetainer) return { label: "Your retainer invoice is ready.", to: "/portal/invoices", cta: "View invoice" };

    const { data: qs } = await supabase
      .from("questionnaires").select("id, status").eq("client_id", clientId).neq("status", "complete");
    if (qs && qs.length > 0) return { label: "Tell us about your wedding day.", to: "/portal/documents", cta: "Open form" };

    if (client.wedding_date) {
      const d = daysBetween(client.wedding_date);
      if (d !== null && d <= 7 && d >= 0) return { label: "We'll see you soon.", soft: true };
      if (d !== null && d < 0) return { label: "We're crafting your gallery with care.", soft: true };
    }

    const { data: gals } = await supabase
      .from("galleries").select("id, gallery_type, delivered_at").eq("client_id", clientId).eq("gallery_type", "wedding");
    const delivered = (gals ?? []).find((g: any) => g.delivered_at);
    if (delivered) return { label: "Your gallery is ready to view.", to: "/portal/gallery", cta: "Open gallery" };
  }

  if (status === "lead") {
    const { data: bookings } = await supabase
      .from("bookings").select("id, scheduled_at").eq("client_id", clientId).order("scheduled_at", { ascending: true }).limit(1);
    if (bookings && bookings[0]?.scheduled_at) {
      return { label: `Your call is on ${shortDate(bookings[0].scheduled_at)}.`, to: "/portal/messages", cta: "Open messages" };
    }
    const { data: props } = await supabase
      .from("proposals").select("id, status").eq("client_id", clientId).order("created_at", { ascending: false }).limit(1);
    if (props && props[0] && props[0].status === "sent") {
      return { label: "Your proposal is ready to review.", to: "/portal/documents", cta: "View proposal" };
    }
    return { label: "We'll send your proposal after our discovery call.", to: "/portal/messages", cta: "Open messages" };
  }

  return null;
}
