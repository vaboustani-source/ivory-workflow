import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useViewAs } from "@/lib/view-as";
import { editorialDate, relativeTime, shortDate, parseDateFlexible } from "@/lib/dates";
import { toast } from "sonner";
import {
  RefreshCw, MessageCircle, FileText, ClipboardList, AlertCircle,
  AtSign, Send, Check, Clock, X, Sparkles, Keyboard, Maximize2, ChevronUp, ChevronDown,
} from "lucide-react";

export const Route = createFileRoute("/studio/queue")({
  component: QueuePage,
});

// =====================================================================
// Types
// =====================================================================
type ItemType =
  | "message_reply"
  | "contract_followup"
  | "questionnaire_followup"
  | "milestone_overdue"
  | "mention_reply";

interface QueueItem {
  id: string;                  // unique key per card
  type: ItemType;
  priority: number;            // higher = more urgent (sorts first)
  ageMs: number;               // older = sorts first when priority ties
  client_id: string | null;
  couple_names: string;
  wedding_date: string | null;
  context: any;                // type-specific payload (rendered in card)
}

const PRIORITY: Record<ItemType, number> = {
  mention_reply: 5,
  message_reply: 4,
  milestone_overdue: 3,
  contract_followup: 2,
  questionnaire_followup: 1,
};

const TYPE_LABEL: Record<ItemType, string> = {
  message_reply: "Reply needed",
  mention_reply: "You were mentioned",
  contract_followup: "Contract follow-up",
  questionnaire_followup: "Questionnaire nudge",
  milestone_overdue: "Overdue milestone",
};

const TYPE_ICON: Record<ItemType, typeof MessageCircle> = {
  message_reply: MessageCircle,
  mention_reply: AtSign,
  contract_followup: FileText,
  questionnaire_followup: ClipboardList,
  milestone_overdue: AlertCircle,
};

function coupleName(c: any): string {
  if (!c) return "—";
  return `${c.couple_name_1}${c.couple_name_2 ? " & " + c.couple_name_2 : ""}`;
}

function businessDaysAgoIso(days: number): string {
  // approximation: days * 1.4 to skip weekends
  const ms = Date.now() - Math.round(days * 1.4) * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString();
}

function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000)));
}

// Filter out reminders, system events, internal tasks, and stale (>14d) milestones.
const SYSTEM_EVENT_TITLES = new Set<string>([
  "Welcome email",
  "Full portal unlocked",
  "Grant inquiry portal access",
  "Client Welcome Guide surfaces",
  "Engagement branch activates",
  "Album branch activates",
  "Videography branch activates",
]);
const HIDDEN_ACTION_TYPES = new Set<string>(["reminder", "system_event", "auto"]);

function isHumanActionMilestone(m: any, fourteenDaysAgoIsoDate: string): boolean {
  if (!m?.due_date) return false;
  if (m.due_date <= fourteenDaysAgoIsoDate) return false;
  if (m.action_type && HIDDEN_ACTION_TYPES.has(m.action_type)) return false;
  const title: string = m.title ?? "";
  if (/^reminder:/i.test(title)) return false;
  if (/^internal:/i.test(title)) return false;
  if (SYSTEM_EVENT_TITLES.has(title)) return false;
  return true;
}

// =====================================================================
// Page
// =====================================================================
function QueuePage() {
  const { profile } = useAuth();
  const { effectiveUserId, isRealOwner, viewingAs } = useViewAs();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [removing, setRemoving] = useState<Set<string>>(new Set());

  const loadQueue = useCallback(async (silent = false) => {
    if (!effectiveUserId) return;
    if (!silent) setLoading(true); else setRefreshing(true);

    try {
      // Determine scope. Owner without view-as → all. Otherwise → assigned client_ids.
      let scopedIds: string[] | null = null;
      if (!(isRealOwner && !viewingAs)) {
        const { data } = await supabase
          .from("clients")
          .select("id")
          .or(`manager_id.eq.${effectiveUserId},photographer_id.eq.${effectiveUserId}`);
        scopedIds = (data ?? []).map((r: any) => r.id);
      }
      const scopeFilter = scopedIds === null ? null : scopedIds;

      const collected: QueueItem[] = [];

      // ----- 1. Unanswered client messages (last message from client, no studio reply) -----
      // Scope: owner sees all conversations; others see conversations for clients they're assigned to.
      // We do NOT gate on participant.last_read_at — that just tracks UI viewing, not whether
      // studio actually replied. The authoritative signal is "last message sender role = client".
      let convosQ = supabase
        .from("conversations")
        .select("id, client_id, last_message_at, last_message_preview, client:clients(couple_name_1, couple_name_2, wedding_date)")
        .not("last_message_at", "is", null);
      if (scopeFilter !== null) {
        convosQ = scopeFilter.length > 0
          ? convosQ.in("client_id", scopeFilter)
          : convosQ.eq("client_id", "00000000-0000-0000-0000-000000000000");
      }
      const { data: allConvos } = await convosQ;

      const convoIds: string[] = [];
      const convoMap = new Map<string, any>();
      (allConvos ?? []).forEach((c: any) => {
        if (!c?.id || !c.last_message_at) return;
        convoIds.push(c.id);
        convoMap.set(c.id, c);
      });

      if (convoIds.length > 0) {
        // Pull most recent non-deleted message per conversation. Simpler: pull last 1 per convo via separate queries → batched query and dedupe.
        const { data: lastMsgs } = await supabase
          .from("messages")
          .select("id, conversation_id, sender_id, content, is_internal_note, created_at, sender:profiles!messages_sender_id_fkey(role, full_name)")
          .in("conversation_id", convoIds)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(200);

        const seen = new Set<string>();
        (lastMsgs ?? []).forEach((m: any) => {
          if (seen.has(m.conversation_id)) return;
          seen.add(m.conversation_id);
          // Only surface if last message was from a client (sender role 'client')
          if (m.sender?.role !== "client") return;
          if (m.is_internal_note) return;
          const c = convoMap.get(m.conversation_id);
          if (!c) return;
          collected.push({
            id: `msg:${m.id}`,
            type: "message_reply",
            priority: PRIORITY.message_reply,
            ageMs: Date.now() - new Date(m.created_at).getTime(),
            client_id: c.client_id,
            couple_names: coupleName(c.client),
            wedding_date: c.client?.wedding_date ?? null,
            context: {
              message_id: m.id,
              conversation_id: m.conversation_id,
              last_message: m.content ?? "",
              sender_name: m.sender?.full_name,
              created_at: m.created_at,
            },
          });
        });
      }

      // ----- 2. Sent contracts unsigned > 3 business days -----
      let contractsQ = supabase
        .from("contracts")
        .select("id, title, sent_at, client_id, client:clients(couple_name_1, couple_name_2, wedding_date)")
        .eq("status", "sent")
        .lt("sent_at", businessDaysAgoIso(3));
      if (scopeFilter !== null) {
        contractsQ = scopeFilter.length > 0
          ? contractsQ.in("client_id", scopeFilter)
          : contractsQ.eq("client_id", "00000000-0000-0000-0000-000000000000");
      }
      const { data: contracts } = await contractsQ;
      (contracts ?? []).forEach((c: any) => {
        collected.push({
          id: `contract:${c.id}`,
          type: "contract_followup",
          priority: PRIORITY.contract_followup,
          ageMs: Date.now() - new Date(c.sent_at).getTime(),
          client_id: c.client_id,
          couple_names: coupleName(c.client),
          wedding_date: c.client?.wedding_date ?? null,
          context: {
            contract_id: c.id,
            contract_title: c.title ?? "Contract",
            sent_at: c.sent_at,
            days_outstanding: daysSince(c.sent_at),
          },
        });
      });

      // ----- 3. Sent questionnaires not started > 5 days -----
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
      let qQ = supabase
        .from("questionnaires")
        .select("id, sent_at, status, client_id, template:questionnaire_templates(name), client:clients(couple_name_1, couple_name_2, wedding_date)")
        .eq("status", "not_started")
        .lt("sent_at", fiveDaysAgo);
      if (scopeFilter !== null) {
        qQ = scopeFilter.length > 0
          ? qQ.in("client_id", scopeFilter)
          : qQ.eq("client_id", "00000000-0000-0000-0000-000000000000");
      }
      const { data: qs } = await qQ;
      (qs ?? []).forEach((q: any) => {
        collected.push({
          id: `quest:${q.id}`,
          type: "questionnaire_followup",
          priority: PRIORITY.questionnaire_followup,
          ageMs: Date.now() - new Date(q.sent_at).getTime(),
          client_id: q.client_id,
          couple_names: coupleName(q.client),
          wedding_date: q.client?.wedding_date ?? null,
          context: {
            questionnaire_id: q.id,
            questionnaire_name: q.template?.name ?? "Questionnaire",
            sent_at: q.sent_at,
            days_outstanding: daysSince(q.sent_at),
          },
        });
      });

      // ----- 4. Overdue milestones assigned to me (RLS handles scope) -----
      const today = new Date().toISOString().slice(0, 10);
      const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { data: milestones } = await supabase
        .from("timeline_milestones")
        .select("id, title, due_date, action_type, client_id, client:clients(couple_name_1, couple_name_2, wedding_date)")
        .eq("status", "upcoming")
        .lt("due_date", today);

      let hiddenMilestoneCount = 0;
      (milestones ?? []).forEach((m: any) => {
        if (!isHumanActionMilestone(m, fourteenDaysAgo)) {
          hiddenMilestoneCount += 1;
          return;
        }
        collected.push({
          id: `ms:${m.id}`,
          type: "milestone_overdue",
          priority: PRIORITY.milestone_overdue,
          ageMs: Date.now() - parseDateFlexible(m.due_date).getTime(),
          client_id: m.client_id,
          couple_names: coupleName(m.client),
          wedding_date: m.client?.wedding_date ?? null,
          context: {
            milestone_id: m.id,
            title: m.title,
            due_date: m.due_date,
          },
        });
      });
      setHiddenCount(hiddenMilestoneCount);

      // ----- 5. Unread mentions of me -----
      const { data: mentions } = await supabase
        .from("message_mentions")
        .select("id, message_id, created_at, message:messages(id, conversation_id, content, sender_id, sender:profiles!messages_sender_id_fkey(full_name), conversation:conversations(client_id, client:clients(couple_name_1, couple_name_2, wedding_date)))")
        .eq("mentioned_user_id", effectiveUserId)
        .is("read_at", null);
      (mentions ?? []).forEach((m: any) => {
        const msg = m.message;
        if (!msg) return;
        const c = msg.conversation;
        collected.push({
          id: `mention:${m.id}`,
          type: "mention_reply",
          priority: PRIORITY.mention_reply,
          ageMs: Date.now() - new Date(m.created_at).getTime(),
          client_id: c?.client_id ?? null,
          couple_names: coupleName(c?.client),
          wedding_date: c?.client?.wedding_date ?? null,
          context: {
            mention_id: m.id,
            message_id: msg.id,
            conversation_id: msg.conversation_id,
            mention_excerpt: msg.content ?? "",
            sender_name: msg.sender?.full_name,
          },
        });
      });

      // Sort: priority desc, age desc (older first)
      collected.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return b.ageMs - a.ageMs;
      });

      setItems(collected);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [effectiveUserId, isRealOwner, viewingAs?.id]);

  useEffect(() => {
    loadQueue();
    const interval = setInterval(() => loadQueue(true), 60_000);
    return () => clearInterval(interval);
  }, [loadQueue]);

  const removeWithAnim = useCallback((id: string) => {
    setRemoving((prev) => new Set(prev).add(id));
    setTimeout(() => {
      setItems((prev) => prev.filter((it) => it.id !== id));
      setRemoving((prev) => { const n = new Set(prev); n.delete(id); return n; });
      // Background refresh so new items can surface
      loadQueue(true);
    }, 250);
  }, [loadQueue]);

  // ---------- Group items by client ----------
  const groups = useMemo(() => {
    const map = new Map<string, { client_id: string | null; couple_names: string; wedding_date: string | null; items: QueueItem[] }>();
    items.forEach((it) => {
      const key = it.client_id ?? "__none__";
      if (!map.has(key)) {
        map.set(key, { client_id: it.client_id, couple_names: it.couple_names, wedding_date: it.wedding_date, items: [] });
      }
      map.get(key)!.items.push(it);
    });
    // Sort groups: most-urgent item first (highest priority within group, then oldest age)
    return Array.from(map.values()).sort((a, b) => {
      const ai = a.items[0]; const bi = b.items[0];
      if (bi.priority !== ai.priority) return bi.priority - ai.priority;
      return bi.ageMs - ai.ageMs;
    });
  }, [items]);

  // ---------- Keyboard shortcuts ----------
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const flatItems = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const cardRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  useEffect(() => {
    if (!selectedId && flatItems.length > 0) setSelectedId(flatItems[0].id);
    if (selectedId && !flatItems.find((it) => it.id === selectedId)) {
      setSelectedId(flatItems[0]?.id ?? null);
    }
  }, [flatItems, selectedId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = flatItems.findIndex((it) => it.id === selectedId);
      if (e.key === "j") {
        e.preventDefault();
        const next = flatItems[Math.min(flatItems.length - 1, Math.max(0, idx + 1))];
        if (next) setSelectedId(next.id);
      } else if (e.key === "k") {
        e.preventDefault();
        const prev = flatItems[Math.max(0, idx - 1)];
        if (prev) setSelectedId(prev.id);
      } else if (e.key === "?") {
        e.preventDefault();
        setHelpOpen((v) => !v);
      } else if (e.key === "f") {
        e.preventDefault();
        if (flatItems.length > 0) setFocusMode((v) => !v);
      } else if (e.key === "Escape") {
        if (focusMode) setFocusMode(false);
        else if (helpOpen) setHelpOpen(false);
      } else if (e.key === "r") {
        e.preventDefault();
        const el = cardRefs.current.get(selectedId ?? "");
        const ta = el?.querySelector("textarea") as HTMLTextAreaElement | null;
        if (ta) { ta.focus(); }
      } else if (e.key === "e") {
        e.preventDefault();
        const el = cardRefs.current.get(selectedId ?? "");
        const btn = el?.querySelector<HTMLButtonElement>('[data-action="primary"]');
        btn?.click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flatItems, selectedId, focusMode, helpOpen]);

  // Scroll selected into view
  useEffect(() => {
    if (!selectedId) return;
    const el = cardRefs.current.get(selectedId);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  const selectedItem = flatItems.find((it) => it.id === selectedId);

  return (
    <div>
      {/* Header */}
      <div className="flex items-end justify-between mb-2">
        <div>
          <h1 className="font-serif italic text-4xl text-primary tracking-tight">Today</h1>
          <p className="font-serif italic text-base text-muted-foreground mt-1">
            {greeting(profile?.full_name)}
          </p>
        </div>
        <div className="flex items-center gap-4">
          {flatItems.length > 0 && (
            <button
              onClick={() => setFocusMode(true)}
              className="flex items-center gap-1.5 text-xs uppercase tracking-[0.18em] text-muted-foreground hover:text-primary"
              title="Focus mode (f)"
            >
              <Maximize2 size={13} /> Focus
            </button>
          )}
          <button
            onClick={() => setHelpOpen(true)}
            className="flex items-center gap-1.5 text-xs uppercase tracking-[0.18em] text-muted-foreground hover:text-primary"
            title="Keyboard shortcuts (?)"
          >
            <Keyboard size={13} /> Shortcuts
          </button>
          <button
            onClick={() => loadQueue()}
            disabled={loading || refreshing}
            className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground hover:text-primary disabled:opacity-50"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>
      <div className="h-px bg-gold/30 max-w-3xl mb-6" />

      {loading ? (
        <LoadingState />
      ) : groups.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-6 max-w-3xl">
          {groups.map((g) => (
            <ClientGroupCard
              key={g.client_id ?? "__none__"}
              group={g}
              selectedId={selectedId}
              onSelect={setSelectedId}
              cardRefs={cardRefs}
              removing={removing}
              onRemove={removeWithAnim}
            />
          ))}
        </div>
      )}

      {!loading && hiddenCount > 0 && (
        <div className="max-w-3xl mt-8 pt-4 border-t border-border/50 text-center">
          <Link
            to="/studio/queue/hidden"
            className="text-xs italic text-muted-foreground hover:text-primary"
          >
            {hiddenCount} {hiddenCount === 1 ? "item" : "items"} hidden (reminders, system events, internal tasks)
          </Link>
        </div>
      )}

      {helpOpen && <ShortcutsOverlay onClose={() => setHelpOpen(false)} />}
      {focusMode && selectedItem && (
        <FocusOverlay
          item={selectedItem}
          index={flatItems.findIndex((it) => it.id === selectedItem.id)}
          total={flatItems.length}
          onPrev={() => {
            const i = flatItems.findIndex((it) => it.id === selectedItem.id);
            const prev = flatItems[Math.max(0, i - 1)];
            if (prev) setSelectedId(prev.id);
          }}
          onNext={() => {
            const i = flatItems.findIndex((it) => it.id === selectedItem.id);
            const next = flatItems[Math.min(flatItems.length - 1, i + 1)];
            if (next) setSelectedId(next.id);
          }}
          onRemove={() => removeWithAnim(selectedItem.id)}
          onClose={() => setFocusMode(false)}
        />
      )}
    </div>
  );
}

function greeting(name?: string | null): string {
  const hr = new Date().getHours();
  const first = (name ?? "").split(" ")[0] || "there";
  if (hr < 5) return `Late night, ${first}.`;
  if (hr < 12) return `Morning, ${first}.`;
  if (hr < 17) return `Afternoon, ${first}.`;
  return `Evening, ${first}.`;
}

// =====================================================================
// Client group card
// =====================================================================
function urgencyForWedding(wedding_date: string | null): { label: string; tone: "magenta" | "gold" | "muted" } | null {
  if (!wedding_date) return null;
  const ms = parseDateFlexible(wedding_date).getTime() - Date.now();
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  if (days < 0) return { label: "Past", tone: "muted" };
  if (days <= 7) return { label: "Today", tone: "magenta" };
  if (days <= 30) return { label: "This week", tone: "gold" };
  return { label: "Soon", tone: "muted" };
}

function countdownLabel(wedding_date: string | null): string | null {
  if (!wedding_date) return null;
  const ms = new Date(wedding_date).getTime() - Date.now();
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  if (days < 0) return `${Math.abs(days)} days ago`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `${days} days`;
}

function ClientGroupCard({
  group, selectedId, onSelect, cardRefs, removing, onRemove,
}: {
  group: { client_id: string | null; couple_names: string; wedding_date: string | null; items: QueueItem[] };
  selectedId: string | null;
  onSelect: (id: string) => void;
  cardRefs: React.MutableRefObject<Map<string, HTMLDivElement | null>>;
  removing: Set<string>;
  onRemove: (id: string) => void;
}) {
  const urgency = urgencyForWedding(group.wedding_date);
  const countdown = countdownLabel(group.wedding_date);
  const toneClass =
    urgency?.tone === "magenta" ? "bg-magenta/10 text-magenta border-magenta/30"
    : urgency?.tone === "gold" ? "bg-gold/15 text-plum border-gold/40"
    : "bg-muted/30 text-muted-foreground border-border";

  return (
    <section className="bg-surface border border-primary/15 rounded-sm shadow-sm overflow-hidden">
      <header className="flex items-start justify-between px-5 py-4 border-b border-primary/10 bg-background-alt/40">
        <div className="min-w-0">
          {group.client_id ? (
            <Link to="/studio/clients/$id" params={{ id: group.client_id }}
              className="font-serif italic text-2xl text-primary hover:underline leading-tight">
              {group.couple_names}
            </Link>
          ) : (
            <span className="font-serif italic text-2xl text-primary leading-tight">{group.couple_names}</span>
          )}
          <div className="flex items-center gap-2 mt-1 text-[12px] text-muted-foreground">
            {group.wedding_date && <span>{shortDate(group.wedding_date)}</span>}
            {countdown && <span className="text-foreground/70">· {countdown}</span>}
            <span>· {group.items.length} item{group.items.length === 1 ? "" : "s"}</span>
          </div>
        </div>
        {urgency && (
          <span className={`text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded-full border ${toneClass}`}>
            {urgency.label}
          </span>
        )}
      </header>
      <div className="divide-y divide-primary/10">
        {group.items.map((it) => (
          <div
            key={it.id}
            ref={(el) => { cardRefs.current.set(it.id, el); }}
            onClick={() => onSelect(it.id)}
            className={`transition-all duration-250 ease-out ${
              removing.has(it.id) ? "opacity-0 -translate-x-4" : "opacity-100"
            } ${selectedId === it.id ? "bg-gold/[0.04]" : ""} relative`}
          >
            {selectedId === it.id && <span className="absolute left-0 top-2 bottom-2 w-[3px] bg-gold rounded-r" />}
            <CompactItemRow item={it} onRemove={() => onRemove(it.id)} />
          </div>
        ))}
      </div>
    </section>
  );
}

function CompactItemRow({ item, onRemove }: { item: QueueItem; onRemove: () => void }) {
  const Icon = TYPE_ICON[item.type];
  return (
    <div className="px-5 py-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={13} className="text-gold" />
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{TYPE_LABEL[item.type]}</span>
        <span className="text-[10px] text-muted-foreground italic ml-auto">
          {item.ageMs > 0 ? relativeTime(new Date(Date.now() - item.ageMs).toISOString()) : "just now"}
        </span>
      </div>
      {item.type === "message_reply" || item.type === "mention_reply" ? (
        <MessageReplyCard item={item} onDone={onRemove} />
      ) : item.type === "contract_followup" ? (
        <ContractFollowupCard item={item} onDone={onRemove} />
      ) : item.type === "questionnaire_followup" ? (
        <QuestionnaireFollowupCard item={item} onDone={onRemove} />
      ) : (
        <MilestoneCard item={item} onDone={onRemove} />
      )}
    </div>
  );
}

// =====================================================================
// Shortcuts overlay
// =====================================================================
function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ["j", "Next item"],
    ["k", "Previous item"],
    ["r", "Reply (focus draft)"],
    ["e", "Mark done / send"],
    ["f", "Toggle Focus mode"],
    ["?", "Show this help"],
    ["Esc", "Close overlay"],
  ];
  return (
    <div className="fixed inset-0 z-50 bg-foreground/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-md shadow-elevated w-full max-w-[420px] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-serif italic text-xl text-primary">Keyboard shortcuts</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-primary"><X size={16} /></button>
        </div>
        <ul className="space-y-2">
          {rows.map(([k, label]) => (
            <li key={k} className="flex items-center justify-between text-sm">
              <span className="text-foreground/80">{label}</span>
              <kbd className="font-mono text-[11px] bg-background-alt border border-border px-2 py-0.5 rounded">{k}</kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// =====================================================================
// Focus mode overlay (one item, full-bleed)
// =====================================================================
function FocusOverlay({
  item, index, total, onPrev, onNext, onRemove, onClose,
}: {
  item: QueueItem; index: number; total: number;
  onPrev: () => void; onNext: () => void; onRemove: () => void; onClose: () => void;
}) {
  const Icon = TYPE_ICON[item.type];
  const countdown = countdownLabel(item.wedding_date);
  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      <header className="flex items-center justify-between px-8 py-5 border-b border-border">
        <div className="flex items-center gap-3">
          <Icon size={16} className="text-gold" />
          <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{TYPE_LABEL[item.type]}</span>
          <span className="text-muted-foreground">·</span>
          <span className="font-serif italic text-2xl text-primary">{item.couple_names}</span>
          {countdown && <span className="text-xs text-muted-foreground ml-2">{countdown}</span>}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground tabular-nums">{index + 1} / {total}</span>
          <button onClick={onPrev} className="p-2 rounded hover:bg-background-alt text-muted-foreground hover:text-primary" title="Previous (k)">
            <ChevronUp size={16} />
          </button>
          <button onClick={onNext} className="p-2 rounded hover:bg-background-alt text-muted-foreground hover:text-primary" title="Next (j)">
            <ChevronDown size={16} />
          </button>
          <button onClick={onClose} className="p-2 rounded hover:bg-background-alt text-muted-foreground hover:text-primary" title="Exit (Esc)">
            <X size={16} />
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto py-12 px-8">
          {item.type === "message_reply" || item.type === "mention_reply" ? (
            <MessageReplyCard item={item} onDone={onRemove} />
          ) : item.type === "contract_followup" ? (
            <ContractFollowupCard item={item} onDone={onRemove} />
          ) : item.type === "questionnaire_followup" ? (
            <QuestionnaireFollowupCard item={item} onDone={onRemove} />
          ) : (
            <MilestoneCard item={item} onDone={onRemove} />
          )}
        </div>
      </div>
    </div>
  );
}


// =====================================================================
// Card
// =====================================================================
function QueueCard({ item, onRemove }: { item: QueueItem; onRemove: () => void }) {
  const Icon = TYPE_ICON[item.type];
  return (
    <article className="bg-surface border border-primary/10 rounded-sm shadow-sm">
      {/* Header strip */}
      <header className="flex items-center justify-between px-5 py-3 border-b border-primary/10 bg-background-alt/30">
        <div className="flex items-center gap-3">
          <Icon size={15} className="text-gold" />
          <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            {TYPE_LABEL[item.type]}
          </span>
          {item.client_id ? (
            <Link
              to="/studio/clients/$id"
              params={{ id: item.client_id }}
              className="font-serif text-[15px] text-primary hover:underline"
            >
              {item.couple_names}
            </Link>
          ) : (
            <span className="font-serif text-[15px] text-primary">{item.couple_names}</span>
          )}
          {item.wedding_date && (
            <span className="text-[11px] text-muted-foreground">
              · wedding {editorialDate(new Date(item.wedding_date))}
            </span>
          )}
        </div>
        <span className="text-[11px] text-muted-foreground italic">
          {item.ageMs > 0 ? relativeTime(new Date(Date.now() - item.ageMs).toISOString()) : "just now"}
        </span>
      </header>

      {/* Body */}
      <div className="px-5 py-4">
        {item.type === "message_reply" || item.type === "mention_reply" ? (
          <MessageReplyCard item={item} onDone={onRemove} />
        ) : item.type === "contract_followup" ? (
          <ContractFollowupCard item={item} onDone={onRemove} />
        ) : item.type === "questionnaire_followup" ? (
          <QuestionnaireFollowupCard item={item} onDone={onRemove} />
        ) : (
          <MilestoneCard item={item} onDone={onRemove} />
        )}
      </div>
    </article>
  );
}

// =====================================================================
// Per-type bodies
// =====================================================================
function useDraft(itemType: ItemType, ctx: any, enabled: boolean) {
  const [draft, setDraft] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<"claude" | "fallback" | null>(null);
  const generated = useRef(false);

  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const itemTypeRef = useRef(itemType);
  itemTypeRef.current = itemType;

  const generate = useCallback(async () => {
    setLoading(true);
    try {
      console.log("[useDraft] invoking draft-reply-with-claude", { item_type: itemTypeRef.current });
      const { data, error } = await supabase.functions.invoke("draft-reply-with-claude", {
        body: { item_type: itemTypeRef.current, context: ctxRef.current },
      });
      if (error) throw error;
      setDraft(data?.draft ?? "");
      setSource(data?.source ?? "fallback");
    } catch (err) {
      console.warn("draft generation failed", err);
      setDraft("");
      setSource("fallback");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled || generated.current) return;
    generated.current = true;
    const t = setTimeout(() => { generate(); }, 500);
    return () => clearTimeout(t);
  }, [enabled, generate]);

  return { draft, setDraft, loading, source, regenerate: () => { generated.current = true; generate(); } };
}

function MessageReplyCard({ item, onDone }: { item: QueueItem; onDone: () => void }) {
  const ctx = item.context;
  const { draft, setDraft, loading, source, regenerate } = useDraft(
    item.type === "mention_reply" ? "mention_reply" : "message_reply",
    {
      couple_names: item.couple_names,
      last_message: ctx.last_message,
      mention_excerpt: ctx.mention_excerpt,
      wedding_date: item.wedding_date,
    },
    true,
  );
  const [sending, setSending] = useState(false);
  const navigate = useNavigate();

  const send = async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from("messages").insert({
        conversation_id: ctx.conversation_id,
        sender_id: userData.user?.id,
        content: draft.trim(),
        is_internal_note: false,
      });
      if (error) throw error;

      // If this card was a mention, also mark the mention read
      if (item.type === "mention_reply" && ctx.mention_id) {
        await supabase.from("message_mentions").update({ read_at: new Date().toISOString() }).eq("id", ctx.mention_id);
      }

      toast.success(`Sent to ${item.couple_names}`);
      onDone();
    } catch (err: any) {
      toast.error(err.message ?? "Could not send");
    } finally {
      setSending(false);
    }
  };

  const dismiss = async () => {
    if (item.type === "mention_reply" && ctx.mention_id) {
      await supabase.from("message_mentions").update({ read_at: new Date().toISOString() }).eq("id", ctx.mention_id);
    }
    onDone();
  };

  return (
    <div className="space-y-3">
      {/* Quoted message */}
      <div className="border-l-2 border-gold/60 pl-3 py-1">
        {ctx.sender_name && (
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-1">
            {ctx.sender_name} wrote
          </p>
        )}
        <p className="text-sm text-foreground/90 italic font-serif whitespace-pre-wrap">
          "{(ctx.last_message ?? ctx.mention_excerpt ?? "").slice(0, 360)}
          {(ctx.last_message ?? ctx.mention_excerpt ?? "").length > 360 ? "…" : ""}"
        </p>
      </div>

      {/* Draft textarea */}
      <div className="relative">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={loading ? "Drafting a reply…" : "Write a reply…"}
          rows={4}
          disabled={loading}
          className={`w-full px-3 py-2 bg-background border border-primary/15 rounded-sm text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none ${
            loading ? "animate-pulse" : ""
          }`}
        />
        {source === "claude" && !loading && (
          <span className="absolute top-2 right-2 flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-gold">
            <Sparkles size={11} /> AI draft
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <button
          onClick={regenerate}
          disabled={loading}
          className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground hover:text-primary disabled:opacity-40"
        >
          Regenerate
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={dismiss}
            className="px-3 py-1.5 text-xs text-muted-foreground hover:text-magenta inline-flex items-center gap-1.5"
          >
            <X size={12} /> Dismiss
          </button>
          <button
            onClick={() => navigate({ to: "/studio/messages", search: { conversation_id: ctx.conversation_id } as any })}
            className="px-3 py-1.5 text-xs text-primary hover:bg-primary/5 rounded-sm border border-primary/20"
          >
            Open thread
          </button>
          <button
            onClick={send}
            disabled={!draft.trim() || sending}
            className="px-4 py-1.5 text-xs bg-primary text-primary-foreground rounded-sm inline-flex items-center gap-1.5 hover:opacity-90 disabled:opacity-40"
          >
            <Send size={12} /> {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ContractFollowupCard({ item, onDone }: { item: QueueItem; onDone: () => void }) {
  const ctx = item.context;
  const { draft, setDraft, loading, source, regenerate } = useDraft(
    "contract_followup",
    {
      couple_names: item.couple_names,
      contract_title: ctx.contract_title,
      days_outstanding: ctx.days_outstanding,
      wedding_date: item.wedding_date,
    },
    true,
  );
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!draft.trim() || !item.client_id) return;
    setSending(true);
    try {
      // Find or create conversation for this client
      const { data: conv } = await supabase
        .from("conversations")
        .select("id")
        .eq("client_id", item.client_id)
        .maybeSingle();
      if (!conv) { toast.error("No conversation exists for this client yet"); setSending(false); return; }

      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from("messages").insert({
        conversation_id: conv.id,
        sender_id: userData.user?.id,
        content: draft.trim(),
        is_internal_note: false,
      });
      if (error) throw error;
      toast.success(`Nudge sent to ${item.couple_names}`);
      onDone();
    } catch (err: any) {
      toast.error(err.message ?? "Could not send");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="text-sm text-foreground/90">
        Sent <strong>{ctx.days_outstanding} days ago</strong> · "{ctx.contract_title}" still unsigned.
      </div>
      <div className="relative">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={loading ? "Drafting a nudge…" : "Write a follow-up…"}
          rows={4}
          disabled={loading}
          className={`w-full px-3 py-2 bg-background border border-primary/15 rounded-sm text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none ${loading ? "animate-pulse" : ""}`}
        />
        {source === "claude" && !loading && (
          <span className="absolute top-2 right-2 flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-gold">
            <Sparkles size={11} /> AI draft
          </span>
        )}
      </div>
      <div className="flex items-center justify-between">
        <button onClick={regenerate} disabled={loading} className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground hover:text-primary disabled:opacity-40">Regenerate</button>
        <div className="flex items-center gap-2">
          <button onClick={onDone} className="px-3 py-1.5 text-xs text-muted-foreground hover:text-magenta inline-flex items-center gap-1.5"><X size={12} /> Dismiss</button>
          <button onClick={send} data-action="primary" disabled={!draft.trim() || sending} className="px-4 py-1.5 text-xs bg-primary text-primary-foreground rounded-sm inline-flex items-center gap-1.5 hover:opacity-90 disabled:opacity-40">
            <Send size={12} /> {sending ? "Sending…" : "Send nudge"}
          </button>
        </div>
      </div>
    </div>
  );
}

function QuestionnaireFollowupCard({ item, onDone }: { item: QueueItem; onDone: () => void }) {
  const ctx = item.context;
  const { draft, setDraft, loading, source, regenerate } = useDraft(
    "questionnaire_followup",
    {
      couple_names: item.couple_names,
      questionnaire_name: ctx.questionnaire_name,
      days_outstanding: ctx.days_outstanding,
      wedding_date: item.wedding_date,
    },
    true,
  );
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!draft.trim() || !item.client_id) return;
    setSending(true);
    try {
      const { data: conv } = await supabase
        .from("conversations").select("id").eq("client_id", item.client_id).maybeSingle();
      if (!conv) { toast.error("No conversation exists for this client yet"); setSending(false); return; }
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from("messages").insert({
        conversation_id: conv.id,
        sender_id: userData.user?.id,
        content: draft.trim(),
        is_internal_note: false,
      });
      if (error) throw error;
      toast.success(`Nudge sent to ${item.couple_names}`);
      onDone();
    } catch (err: any) {
      toast.error(err.message ?? "Could not send");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="text-sm text-foreground/90">
        Sent <strong>{ctx.days_outstanding} days ago</strong> · "{ctx.questionnaire_name}" not started yet.
      </div>
      <div className="relative">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={loading ? "Drafting a nudge…" : "Write a follow-up…"}
          rows={4}
          disabled={loading}
          className={`w-full px-3 py-2 bg-background border border-primary/15 rounded-sm text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none ${loading ? "animate-pulse" : ""}`}
        />
        {source === "claude" && !loading && (
          <span className="absolute top-2 right-2 flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-gold">
            <Sparkles size={11} /> AI draft
          </span>
        )}
      </div>
      <div className="flex items-center justify-between">
        <button onClick={regenerate} disabled={loading} className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground hover:text-primary disabled:opacity-40">Regenerate</button>
        <div className="flex items-center gap-2">
          <button onClick={onDone} className="px-3 py-1.5 text-xs text-muted-foreground hover:text-magenta inline-flex items-center gap-1.5"><X size={12} /> Dismiss</button>
          <button onClick={send} data-action="primary" disabled={!draft.trim() || sending} className="px-4 py-1.5 text-xs bg-primary text-primary-foreground rounded-sm inline-flex items-center gap-1.5 hover:opacity-90 disabled:opacity-40">
            <Send size={12} /> {sending ? "Sending…" : "Send nudge"}
          </button>
        </div>
      </div>
    </div>
  );
}

function MilestoneCard({ item, onDone }: { item: QueueItem; onDone: () => void }) {
  const ctx = item.context;
  const [busy, setBusy] = useState(false);

  const markComplete = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from("timeline_milestones").update({
        status: "complete",
        completed_at: new Date().toISOString(),
        completed_by: userData.user?.id,
      }).eq("id", ctx.milestone_id);
      if (error) throw error;
      toast.success(`"${ctx.title}" marked complete`);
      onDone();
    } catch (err: any) {
      toast.error(err.message ?? "Could not update");
    } finally {
      setBusy(false);
    }
  };

  const snooze = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Push due_date by 3 calendar days (approximation of business days without server fn)
      const current = new Date(ctx.due_date);
      const next = new Date(current);
      let added = 0;
      while (added < 3) {
        next.setDate(next.getDate() + 1);
        const day = next.getDay();
        if (day !== 0 && day !== 6) added += 1;
      }
      const newDate = next.toISOString().slice(0, 10);
      const { error } = await supabase.from("timeline_milestones").update({ due_date: newDate }).eq("id", ctx.milestone_id);
      if (error) throw error;
      toast.success(`Snoozed until ${editorialDate(new Date(newDate))}`);
      onDone();
    } catch (err: any) {
      toast.error(err.message ?? "Could not snooze");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="text-sm text-foreground">
        <strong className="font-serif text-base">{ctx.title}</strong>
        <span className="ml-2 text-xs text-magenta">due {editorialDate(new Date(ctx.due_date))} · overdue</span>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button onClick={onDone} className="px-3 py-1.5 text-xs text-muted-foreground hover:text-magenta inline-flex items-center gap-1.5"><X size={12} /> Dismiss</button>
        <button onClick={snooze} disabled={busy} className="px-3 py-1.5 text-xs text-primary hover:bg-primary/5 rounded-sm border border-primary/20 inline-flex items-center gap-1.5 disabled:opacity-40">
          <Clock size={12} /> Snooze 3 days
        </button>
        <button onClick={markComplete} data-action="primary" disabled={busy} className="px-4 py-1.5 text-xs bg-primary text-primary-foreground rounded-sm inline-flex items-center gap-1.5 hover:opacity-90 disabled:opacity-40">
          <Check size={12} /> Mark complete
        </button>
      </div>
    </div>
  );
}

// =====================================================================
// Empty + Loading states
// =====================================================================
function EmptyState() {
  return (
    <div className="bg-surface border border-primary/10 rounded-sm py-16 px-8 text-center">
      <p className="font-serif italic text-[28px] text-primary">All clear.</p>
      <p className="font-serif italic text-base text-muted-foreground mt-2">
        Nothing needs your attention right now.
      </p>
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mt-6">
        Last sync: just now
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4 max-w-3xl">
      <p className="font-serif italic text-sm text-muted-foreground mb-4">
        Pulling together what needs your attention…
      </p>
      {[0, 1, 2].map((i) => (
        <div key={i} className="bg-surface border border-primary/10 rounded-sm">
          <div className="h-10 border-b border-primary/10 bg-background-alt/30 animate-pulse" />
          <div className="p-5 space-y-3">
            <div className="h-3 bg-gold/10 rounded animate-pulse w-3/4" />
            <div className="h-20 bg-gold/5 rounded animate-pulse" />
            <div className="flex justify-end gap-2">
              <div className="h-7 w-16 bg-gold/10 rounded animate-pulse" />
              <div className="h-7 w-20 bg-gold/10 rounded animate-pulse" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
