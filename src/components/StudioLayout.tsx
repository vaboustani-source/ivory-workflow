import { Link, useLocation } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  Home, Users, Inbox, KanbanSquare, Workflow, MessageCircle, Calendar, Mail,
  CheckSquare, Image, Receipt, BookOpen, Settings, Search,
  LogOut, Menu, X, ChevronDown, Eye, FileText, ClipboardList, ClipboardCheck, DollarSign, Newspaper,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useViewAs } from "@/lib/view-as";
import { firstName } from "@/lib/dates";
import { supabase } from "@/integrations/supabase/client";
import { ViewAsModal } from "@/components/ViewAsModal";
import { NotificationsBell } from "@/components/NotificationsBell";
import logoFull from "@/assets/logo-full.png";
import logoMark from "@/assets/logo-mark.png";

type NavItem = {
  label: string;
  to: string;
  icon: typeof Home;
  exact?: boolean;
  matchPrefix?: string;
  badgeKey?: "approval" | "tasks" | "sales" | "production" | "messages" | "contracts" | "forms" | "queue" | "inbox";
  badgeStyle?: "count" | "dot";
  ownerOnly?: boolean;
};

type NavGroup = { label: string | null; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { label: "Today", to: "/studio/queue", icon: ClipboardCheck, badgeKey: "queue" },
    ],
  },
  {
    label: "Daily",
    items: [
      { label: "Inbox", to: "/studio/approval-queue", icon: Inbox, badgeKey: "inbox" },
      { label: "Mail", to: "/studio/mail", icon: Mail },
      { label: "Calendar", to: "/studio/calendar", icon: Calendar },
    ],
  },
  {
    label: "Clients",
    items: [
      { label: "All clients", to: "/studio/clients", icon: Users },
      { label: "Roster", to: "/studio/roster", icon: ClipboardList },
      { label: "Pipeline", to: "/studio/pipeline/sales", icon: KanbanSquare, matchPrefix: "/studio/pipeline", badgeKey: "sales" },
      { label: "Approvals", to: "/studio/approval-queue", icon: ClipboardCheck, badgeKey: "approval" },
    ],
  },
  {
    label: "Library",
    items: [
      { label: "Galleries", to: "/studio/galleries", icon: Image },
      { label: "Documents", to: "/studio/contracts", icon: FileText, matchPrefix: "/studio/contracts", badgeKey: "contracts", badgeStyle: "dot" },
      { label: "Briefings", to: "/studio/briefings", icon: Newspaper },
      { label: "Rolodex", to: "/studio/rolodex", icon: BookOpen },
      { label: "Resources", to: "/studio/resources", icon: BookOpen },
    ],
  },
  {
    label: "Books",
    items: [
      { label: "Financials", to: "/studio/financials", icon: DollarSign },
      { label: "Revenue", to: "/studio/revenue", icon: DollarSign },
      { label: "Profitability", to: "/studio/margin", icon: DollarSign, ownerOnly: true },
      { label: "Invoicing", to: "/studio/invoices", icon: Receipt },

    ],
  },
  {
    label: "Settings",
    items: [
      { label: "Settings", to: "/studio/settings/team", icon: Settings, matchPrefix: "/studio/settings" },
    ],
  },
];

// Reference unused icons so imports stay valid for future PRs.
void [Home, MessageCircle, Workflow, CheckSquare];

export function StudioLayout({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();
  const { viewingAs, setViewAs, isRealOwner, effectiveUserId, effectiveRole } = useViewAs();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const [viewAsModalOpen, setViewAsModalOpen] = useState(false);
  const [badges, setBadges] = useState({ approval: 0, tasks: 0, sales: 0, production: 0, messages: 0, contracts: 0, forms: 0, queue: 0, inbox: 0 });
  const [unreadMentions, setUnreadMentions] = useState(0);

  // Load badge counts. Re-load when impersonation changes.
  useEffect(() => {
    if (!effectiveUserId) return;
    let cancelled = false;
    const today = new Date().toISOString().slice(0, 10);
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const load = async () => {
      // Determine scope: managers/associates -> assigned client_ids; owner (real, no view-as) -> all.
      let scopedIds: string[] | null = null;
      if (!(isRealOwner && !viewingAs)) {
        const { data } = await supabase
          .from("clients")
          .select("id")
          .or(`manager_id.eq.${effectiveUserId},photographer_id.eq.${effectiveUserId}`);
        scopedIds = (data ?? []).map((r) => r.id);
      }

      // Approval queue
      let approvalQ = supabase
        .from("scheduled_communications")
        .select("id", { count: "exact", head: true })
        .eq("status", "awaiting_approval");
      if (scopedIds !== null) {
        approvalQ = scopedIds.length > 0 ? approvalQ.in("client_id", scopedIds) : approvalQ.eq("client_id", "00000000-0000-0000-0000-000000000000");
      }
      const approval = await approvalQ;

      // Overdue tasks for the effective user
      const tasks = await supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("assignee_id", effectiveUserId)
        .eq("status", "pending")
        .lt("due_date", today);

      // Sales pipeline: leads count, scoped if needed
      let salesQ = supabase
        .from("clients")
        .select("id", { count: "exact", head: true })
        .eq("status", "lead");
      if (scopedIds !== null) {
        salesQ = scopedIds.length > 0 ? salesQ.in("id", scopedIds) : salesQ.eq("id", "00000000-0000-0000-0000-000000000000");
      }
      const sales = await salesQ;

      // Production pipeline attention items: distinct client ids with overdue milestones,
      // stale contact, or aged drafts.
      const attentionIds = new Set<string>();
      const inScope = (id: string | null) => id && (scopedIds === null || scopedIds.includes(id));

      const overdueMs = await supabase
        .from("timeline_milestones")
        .select("client_id")
        .eq("status", "upcoming")
        .lt("due_date", today);
      (overdueMs.data ?? []).forEach((r) => { if (inScope(r.client_id)) attentionIds.add(r.client_id!); });

      const stale = await supabase
        .from("clients")
        .select("id")
        .in("status", ["booked", "active"])
        .lt("last_contacted_at", fourteenDaysAgo);
      (stale.data ?? []).forEach((r) => { if (inScope(r.id)) attentionIds.add(r.id); });

      const oldDrafts = await supabase
        .from("scheduled_communications")
        .select("client_id")
        .eq("status", "awaiting_approval")
        .lt("created_at", sevenDaysAgo);
      (oldDrafts.data ?? []).forEach((r) => { if (inScope(r.client_id)) attentionIds.add(r.client_id!); });

      // Unread messages: count of conversations where current user is participant
      // and last_message_at > participant's last_read_at (or last_read_at is null and last_message_at exists)
      let unreadMessages = 0;
      const { data: parts } = await supabase
        .from("conversation_participants")
        .select("conversation_id, last_read_at, conversation:conversations(last_message_at)")
        .eq("user_id", effectiveUserId);
      (parts ?? []).forEach((p: any) => {
        const lm = p.conversation?.last_message_at;
        if (!lm) return;
        if (!p.last_read_at || new Date(lm) > new Date(p.last_read_at)) unreadMessages += 1;
      });

      // Unread mentions for the effective user
      const { count: mentionCount } = await supabase
        .from("message_mentions")
        .select("id", { count: "exact", head: true })
        .eq("mentioned_user_id", effectiveUserId)
        .is("read_at", null);

      // Contracts awaiting signature + forms awaiting response (scoped)
      let contractsQ = supabase.from("contracts").select("id", { count: "exact", head: true }).eq("status", "sent");
      let formsQ = supabase.from("questionnaires").select("id", { count: "exact", head: true }).in("status", ["not_started", "in_progress"]);
      if (scopedIds !== null) {
        if (scopedIds.length > 0) {
          contractsQ = contractsQ.in("client_id", scopedIds);
          formsQ = formsQ.in("client_id", scopedIds);
        } else {
          contractsQ = contractsQ.eq("client_id", "00000000-0000-0000-0000-000000000000");
          formsQ = formsQ.eq("client_id", "00000000-0000-0000-0000-000000000000");
        }
      }
      const [contractsRes, formsRes] = await Promise.all([contractsQ, formsQ]);

      // Queue badge: rough sum of unread client messages + unread mentions + overdue milestones (scoped, filtered).
      const SYS_TITLES = new Set([
        "Welcome email", "Full portal unlocked", "Grant inquiry portal access",
        "Client Welcome Guide surfaces", "Engagement branch activates",
        "Album branch activates", "Videography branch activates",
      ]);
      const HIDDEN_AT = new Set(["reminder", "system_event", "auto"]);
      const fourteenDaysAgoDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      let overdueMilestonesCount = 0;
      const { data: overdueMsCounts } = await supabase
        .from("timeline_milestones")
        .select("client_id, title, action_type, due_date")
        .eq("status", "upcoming")
        .lt("due_date", today);
      (overdueMsCounts ?? []).forEach((r: any) => {
        if (scopedIds !== null && (!r.client_id || !scopedIds.includes(r.client_id))) return;
        if (r.due_date <= fourteenDaysAgoDate) return;
        if (r.action_type && HIDDEN_AT.has(r.action_type)) return;
        const t: string = r.title ?? "";
        if (/^reminder:/i.test(t) || /^internal:/i.test(t)) return;
        if (SYS_TITLES.has(t)) return;
        overdueMilestonesCount += 1;
      });

      if (!cancelled) {
        setBadges({
          approval: approval.count ?? 0,
          tasks: tasks.count ?? 0,
          sales: sales.count ?? 0,
          production: attentionIds.size,
          messages: unreadMessages,
          contracts: contractsRes.count ?? 0,
          forms: formsRes.count ?? 0,
          queue: unreadMessages + (mentionCount ?? 0) + overdueMilestonesCount,
          inbox: unreadMessages + (mentionCount ?? 0) + (approval.count ?? 0) + (tasks.count ?? 0),
        });
        setUnreadMentions(mentionCount ?? 0);
      }
    };
    load();
    const interval = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [effectiveUserId, isRealOwner, viewingAs?.id, location.pathname]);

  const isActive = (item: NavItem) => {
    if (item.exact) return location.pathname === item.to;
    if (item.matchPrefix) return location.pathname.startsWith(item.matchPrefix);
    return location.pathname === item.to || location.pathname.startsWith(item.to + "/");
  };

  const exitViewAs = () => {
    setViewAs(null);
    setTimeout(() => window.location.reload(), 50);
  };

  return (
    <div className="min-h-screen flex bg-background">
      <aside className={`${collapsed ? "w-[60px]" : "w-[220px]"} shrink-0 bg-sidebar text-sidebar-foreground flex flex-col transition-[width] duration-200 sticky top-0 h-screen`}>
        <div className="flex items-center justify-between px-4 py-6">
          {!collapsed && (
            <img src={logoFull} alt="Stories by Victoria" className="h-10 w-auto object-contain" />
          )}
          {collapsed && (
            <img src={logoMark} alt="SBV" className="h-8 w-8 object-contain mx-auto" />
          )}
          <button onClick={() => setCollapsed((c) => !c)} className="text-sidebar-foreground/70 hover:text-gold lg:hidden" aria-label="Toggle sidebar">
            {collapsed ? <Menu size={18} /> : <X size={18} />}
          </button>
        </div>
        <nav className="flex-1 px-2 overflow-y-auto pb-4">
          {NAV_GROUPS.map((group, gi) => (
            <div key={group.label ?? `g-${gi}`} className={gi === 0 ? "" : "mt-5"}>
              {!collapsed && group.label && (
                <p className="px-3 mb-1 text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/40">
                  {group.label}
                </p>
              )}
              {collapsed && group.label && gi !== 0 && (
                <div className="mx-3 my-2 border-t border-sidebar-border/40" />
              )}
              <div className="space-y-0.5">
                {group.items.filter((item) => !item.ownerOnly || (effectiveRole === "owner")).map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item);
                  const badgeCount = item.badgeKey ? badges[item.badgeKey] : 0;
                  return (
                    <Link
                      key={item.to + item.label}
                      to={item.to}
                      className={`group flex items-center gap-3 px-3 py-2.5 rounded-sm text-sm transition-colors relative ${
                        active ? "bg-sidebar-accent text-sidebar-foreground" : "text-sidebar-foreground/80 hover:text-magenta"
                      }`}
                      title={collapsed ? item.label : undefined}
                    >
                      {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] bg-sidebar-foreground rounded-r" />}
                      <Icon size={18} className={active ? "text-gold" : ""} />
                      {!collapsed && <span className="flex-1">{item.label}</span>}
                      {!collapsed && badgeCount > 0 && item.badgeStyle === "dot" && (
                        <span className="h-2 w-2 rounded-full bg-gold" title={`${badgeCount} pending`} />
                      )}
                      {!collapsed && badgeCount > 0 && item.badgeStyle !== "dot" && (
                        <span
                          className="bg-magenta text-background text-[10px] font-semibold rounded-full px-1.5 min-w-[20px] h-[18px] inline-flex items-center justify-center relative"
                          title={item.badgeKey === "messages" && unreadMentions > 0 ? `${badgeCount} unread, ${unreadMentions} mentions` : undefined}
                        >
                          {badgeCount > 99 ? "99+" : badgeCount}
                          {item.badgeKey === "messages" && unreadMentions > 0 && (
                            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-gold ring-1 ring-sidebar" />
                          )}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="p-2 border-t border-sidebar-border">
          <button onClick={() => signOut()} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-sm text-sm text-sidebar-foreground/70 hover:text-magenta" title="Sign out">
            <LogOut size={18} />
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-10 h-16 bg-background border-b border-primary/20 flex items-center px-6 gap-6">
          <span className="font-serif text-primary text-lg tracking-[0.18em]">
            STORIES <span className="italic">by</span> VICTORIA
          </span>
          <div className="flex-1 flex justify-center">
            <div className="relative w-full max-w-[480px]">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input type="search" placeholder="Search clients, messages, notes…" className="w-full pl-9 pr-3 py-2 bg-surface border border-primary/15 rounded-sm text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
          </div>

          {viewingAs && isRealOwner && (
            <div className="flex items-center gap-1.5 bg-gold/90 text-plum rounded-full pl-3 pr-1 py-1 text-xs">
              <Eye size={12} />
              <span className="font-serif italic">Viewing as: {firstName(viewingAs.full_name)}</span>
              <button onClick={exitViewAs} className="hover:bg-plum/10 rounded-full p-0.5" aria-label="Exit view-as">
                <X size={12} />
              </button>
            </div>
          )}

          <NotificationsBell userId={profile?.id ?? null} />

          <div className="relative">
            <button
              onClick={() => setAvatarMenuOpen((o) => !o)}
              className="h-8 w-8 rounded-full bg-plum text-background flex items-center justify-center text-xs font-medium hover:opacity-90"
            >
              {firstName(profile?.full_name).charAt(0).toUpperCase()}
            </button>
            {avatarMenuOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setAvatarMenuOpen(false)} />
                <div className="absolute right-0 top-10 z-30 bg-surface rounded-md shadow-elevated border border-border w-56 py-2">
                  <div className="px-3 py-2 border-b border-border">
                    <p className="text-sm text-foreground">{profile?.full_name ?? "—"}</p>
                    <p className="text-[11px] text-muted-foreground capitalize">{(effectiveRole ?? profile?.role ?? "").replace(/_/g, " ")}</p>
                  </div>
                  {isRealOwner && (
                    <button
                      onClick={() => { setAvatarMenuOpen(false); setViewAsModalOpen(true); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-background-alt/60 text-left"
                    >
                      <Eye size={14} className="text-gold" />
                      View as team member…
                    </button>
                  )}
                  <button
                    onClick={() => { setAvatarMenuOpen(false); signOut(); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-magenta hover:bg-background-alt/60 text-left"
                  >
                    <LogOut size={14} />
                    Sign out
                  </button>
                  <ChevronDown className="hidden" />
                </div>
              </>
            )}
          </div>
        </header>

        <main className="flex-1 px-8 py-8">
          <div className="max-w-[1400px] mx-auto">{children}</div>
        </main>
      </div>

      <ViewAsModal open={viewAsModalOpen} onClose={() => setViewAsModalOpen(false)} />
    </div>
  );
}
