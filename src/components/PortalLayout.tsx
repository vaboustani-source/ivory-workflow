import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Home, Calendar, MessageCircle, FileText, Image, Receipt, BookOpen, User,
  Bell, LogOut, Menu, ClipboardList, Heart, Camera, Activity,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { firstName, shortDate } from "@/lib/dates";

type BadgeKind = "none" | "magenta" | "gold";
type NavBadge = { kind: BadgeKind; count?: number };

type NavItem = {
  label: string;
  to: string;
  icon: typeof Home;
  exact?: boolean;
  matchPrefix?: string;
  hideForLead?: boolean;
  badgeKey?: "messages" | "documents" | "questionnaires" | "portrait";
  showOnlyIfKey?: "portraitExists";
};

const NAV_ITEMS: NavItem[] = [
  { label: "Home", to: "/portal", icon: Home, exact: true },
  { label: "Timeline", to: "/portal/timeline", icon: Calendar, hideForLead: true },
  { label: "Messages", to: "/portal/messages", icon: MessageCircle, badgeKey: "messages" },
  { label: "Documents", to: "/portal/documents", icon: FileText, badgeKey: "documents" },
  { label: "Forms", to: "/portal/questionnaires", icon: ClipboardList, badgeKey: "questionnaires" },
  { label: "Activity", to: "/portal/activity", icon: Activity },
  { label: "Family Portraits", to: "/portal/portrait-sequence", icon: Camera, hideForLead: true, badgeKey: "portrait", showOnlyIfKey: "portraitExists" },
  { label: "Gallery", to: "/portal/gallery", icon: Image, hideForLead: true },
  { label: "Invoices", to: "/portal/invoices", icon: Receipt, badgeKey: "documents" },
  { label: "Resources", to: "/portal/resources", icon: BookOpen, hideForLead: true },
  { label: "Account", to: "/portal/account", icon: User, matchPrefix: "/portal/account" },
];


export function PortalLayout({
  children,
  client,
}: {
  children: ReactNode;
  client: { couple_name_1: string; couple_name_2: string | null; wedding_date: string | null; status: string } | null;
}) {
  const { profile, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [badges, setBadges] = useState<Record<string, NavBadge>>({});
  const [flags, setFlags] = useState<{ portraitExists?: boolean }>({});

  const isLead = client?.status === "lead";
  const visibleNav = NAV_ITEMS.filter((i) => {
    if (isLead && i.hideForLead) return false;
    if (i.showOnlyIfKey && !flags[i.showOnlyIfKey]) return false;
    return true;
  });
  const isActive = (i: NavItem) => {
    if (i.exact) return location.pathname === i.to;
    if (i.matchPrefix) return location.pathname.startsWith(i.matchPrefix);
    return location.pathname === i.to || location.pathname.startsWith(i.to + "/");
  };

  // Poll for unread / action badges every 30s
  useEffect(() => {
    if (!profile || !client) return;
    let cancelled = false;
    const compute = async () => {
      // Look up clientId via client_users
      const { data: cu } = await supabase
        .from("client_users").select("client_id").eq("user_id", profile.id).limit(1).maybeSingle();
      const clientId = cu?.client_id;
      if (!clientId) return;

      const next: Record<string, NavBadge> = {};

      // MESSAGES: unread = last_message_at > my last_read_at on the conversation
      const { data: conv } = await supabase
        .from("conversations").select("id, last_message_at").eq("client_id", clientId).maybeSingle();
      if (conv?.id) {
        const { data: part } = await supabase
          .from("conversation_participants")
          .select("last_read_at")
          .eq("conversation_id", conv.id).eq("user_id", profile.id).maybeSingle();
        const lastRead = part?.last_read_at ? new Date(part.last_read_at).getTime() : 0;
        const lastMsg = conv.last_message_at ? new Date(conv.last_message_at).getTime() : 0;
        if (lastMsg > lastRead) next["messages"] = { kind: "magenta" };
      }

      // DOCUMENTS: unsigned contract OR sent (un-accepted) proposal
      const { data: contracts } = await supabase
        .from("contracts").select("id, status").eq("client_id", clientId);
      const hasUnsigned = (contracts ?? []).some((c: any) => c.status !== "signed");
      const { data: props } = await supabase
        .from("proposals").select("id, status").eq("client_id", clientId);
      const hasOpenProp = (props ?? []).some((p: any) => p.status === "sent");
      if (hasUnsigned || hasOpenProp) next["documents"] = { kind: "gold" };

      // QUESTIONNAIRES: any not_started or in_progress
      const { data: qs } = await supabase
        .from("questionnaires").select("id, status").eq("client_id", clientId);
      const hasOpenQ = (qs ?? []).some((q: any) => q.status === "not_started" || q.status === "in_progress");
      if (hasOpenQ) next["questionnaires"] = { kind: "gold" };

      // PORTRAIT SEQUENCE: show item when row exists; gold dot if not yet approved
      const { data: ps } = await supabase
        .from("portrait_sequences").select("id, approved_at").eq("client_id", clientId).maybeSingle();
      const portraitExists = !!ps?.id;
      if (ps?.id && !ps.approved_at) next["portrait"] = { kind: "gold" };

      if (!cancelled) { setBadges(next); setFlags({ portraitExists }); }
    };
    compute();
    const id = setInterval(compute, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, [profile?.id, client?.status, location.pathname]);

  const coupleNames = client
    ? `${client.couple_name_1}${client.couple_name_2 ? ` & ${client.couple_name_2}` : ""}`
    : "Welcome";


  return (
    <div className="min-h-screen flex bg-background">
      {/* Sidebar */}
      <aside
        className={`${mobileOpen ? "fixed inset-y-0 left-0 z-40 w-[240px]" : "hidden"} md:sticky md:top-0 md:flex md:w-[220px] md:h-screen shrink-0 flex-col bg-[#F5EDE6] border-r border-gold/30`}
      >
        <div className="px-6 pt-8 pb-4">
          <div className="font-serif italic text-3xl text-gold tracking-wide">SBV</div>
          {client && (
            <div className="mt-6">
              <p className="font-serif italic text-[15px] text-primary leading-snug">{coupleNames}</p>
              {client.wedding_date && (
                <p className="text-[11px] text-muted-foreground mt-1">{shortDate(client.wedding_date)}</p>
              )}
            </div>
          )}
        </div>

        <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const active = isActive(item);
            const badge = item.badgeKey ? badges[item.badgeKey] : undefined;
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMobileOpen(false)}
                className={`group flex items-center gap-3 px-3 py-2.5 text-sm transition-colors relative rounded-sm ${
                  active
                    ? "text-primary bg-[#EFE3D8]"
                    : "text-primary/75 hover:text-magenta"
                }`}
              >
                {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] bg-gold rounded-r" />}
                <Icon size={17} className={active ? "text-gold" : ""} />
                <span className="flex-1">{item.label}</span>
                {badge && badge.kind !== "none" && (
                  badge.count && badge.count > 0 ? (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${badge.kind === "magenta" ? "bg-magenta text-background" : "bg-gold text-background"}`}>
                      +{badge.count}
                    </span>
                  ) : (
                    <span className={`h-2 w-2 rounded-full ${badge.kind === "magenta" ? "bg-magenta" : "bg-gold"}`} />
                  )
                )}
              </Link>
            );
          })}
        </nav>


        <div className="px-3 py-4 border-t border-gold/20">
          <button
            onClick={() => signOut()}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm text-primary/70 hover:text-magenta rounded-sm"
          >
            <LogOut size={16} />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-foreground/20 md:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-20 h-16 bg-surface border-b border-gold/30 flex items-center px-4 md:px-8 gap-4">
          <button
            className="md:hidden text-primary"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
          <span className="font-serif text-primary text-base md:text-lg tracking-[0.18em]">
            STORIES <span className="italic">by</span> VICTORIA
          </span>
          <div className="flex-1" />
          <button className="text-primary/70 hover:text-primary" aria-label="Notifications">
            <Bell size={18} />
          </button>
          <div className="relative">
            <button
              onClick={() => setAvatarOpen((o) => !o)}
              className="h-8 w-8 rounded-full bg-primary text-background flex items-center justify-center text-xs font-medium hover:opacity-90"
              aria-label="Account menu"
            >
              {firstName(profile?.full_name || profile?.email || "?").charAt(0).toUpperCase()}
            </button>
            {avatarOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setAvatarOpen(false)} />
                <div className="absolute right-0 top-10 z-40 bg-surface rounded-md shadow-elevated border border-border w-60 py-2">
                  <div className="px-3 py-2 border-b border-border">
                    <p className="text-sm text-foreground truncate">{profile?.full_name ?? "—"}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{profile?.email}</p>
                  </div>
                  <button
                    onClick={() => { setAvatarOpen(false); navigate({ to: "/portal/account" }); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-background-alt/60 text-left"
                  >
                    <User size={14} className="text-gold" /> Account settings
                  </button>
                  <button
                    onClick={() => { setAvatarOpen(false); signOut(); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-magenta hover:bg-background-alt/60 text-left"
                  >
                    <LogOut size={14} /> Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </header>

        <main className="flex-1 px-4 md:px-8 py-6 md:py-10">
          <div className="max-w-[1080px] mx-auto">{children}</div>
        </main>
      </div>
    </div>
  );
}

export function PortalGate({
  children,
}: {
  children: (ctx: {
    clientId: string;
    client: { id: string; couple_name_1: string; couple_name_2: string | null; wedding_date: string | null; status: string; portal_login_mode: string | null; manager_id: string | null; photographer_id: string | null };
  }) => ReactNode;
}) {
  const { loading, profile } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<{ status: "loading" | "ready" | "no-client"; clientId?: string; client?: any }>({ status: "loading" });

  useEffect(() => {
    if (loading || !profile) return;
    if (profile.role !== "client") {
      navigate({ to: "/studio" });
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: cu } = await supabase
        .from("client_users")
        .select("client_id")
        .eq("user_id", profile.id)
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (!cu?.client_id) {
        setState({ status: "no-client" });
        return;
      }
      const { data: client } = await supabase
        .from("clients")
        .select("id, couple_name_1, couple_name_2, wedding_date, status, portal_login_mode, manager_id, photographer_id")
        .eq("id", cu.client_id)
        .maybeSingle();
      if (cancelled) return;
      setState({ status: "ready", clientId: cu.client_id, client });
    })();
    return () => { cancelled = true; };
  }, [loading, profile?.id, profile?.role]);

  if (loading || state.status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="font-serif italic text-xl text-primary">Loading…</p>
      </div>
    );
  }

  if (!profile || profile.role !== "client") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="font-serif italic text-xl text-primary">Redirecting…</p>
      </div>
    );
  }

  if (state.status === "no-client") {
    return (
      <PortalLayout client={null}>
        <div className="bg-surface rounded-lg shadow-soft p-12 text-center border-t-2 border-gold max-w-xl mx-auto mt-12">
          <Heart className="mx-auto text-gold mb-4" size={32} />
          <p className="font-serif italic text-2xl text-primary">Your portal isn't quite ready.</p>
          <p className="text-sm text-muted-foreground mt-3">
            We haven't linked your account to a wedding yet. Please reach out to us at <a className="text-primary underline" href="mailto:hello@victoriaboustani.com">hello@victoriaboustani.com</a>.
          </p>
        </div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout client={state.client}>
      {children({ clientId: state.clientId!, client: state.client })}
    </PortalLayout>
  );
}
