import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useEffectiveScope } from "@/lib/view-as";
import { relativeTime } from "@/lib/dates";
import { Search, Lock } from "lucide-react";
import { MessageThread } from "@/components/messages/MessageThread";

export const Route = createFileRoute("/studio/messages")({
  component: MessagesPage,
});

interface ConversationRow {
  id: string;
  client_id: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  client: { id: string; couple_name_1: string; couple_name_2: string | null; wedding_date: string | null } | null;
  myParticipant?: { last_read_at: string | null };
  hasInternalUnread?: boolean;
}

type Filter = "all" | "unread" | "internal";

function MessagesPage() {
  const { profile } = useAuth();
  const { scopeClientIds } = useEffectiveScope();
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!profile) return;
    const ids = await scopeClientIds();
    let q = supabase
      .from("conversations")
      .select("id, client_id, last_message_at, last_message_preview, client:clients(id, couple_name_1, couple_name_2, wedding_date)")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (ids !== null) {
      if (ids.length === 0) {
        setConversations([]);
        setLoading(false);
        return;
      }
      q = q.in("client_id", ids);
    }
    const { data: convs } = await q;
    const convList = (convs ?? []) as unknown as ConversationRow[];

    // Get my participant rows for unread state
    const convIds = convList.map((c) => c.id);
    const { data: parts } = convIds.length
      ? await supabase
          .from("conversation_participants")
          .select("conversation_id, last_read_at")
          .eq("user_id", profile.id)
          .in("conversation_id", convIds)
      : { data: [] };
    const partMap = new Map<string, { last_read_at: string | null }>();
    (parts ?? []).forEach((p: any) => partMap.set(p.conversation_id, { last_read_at: p.last_read_at }));

    // Internal note unread counts
    const { data: internalMsgs } = convIds.length
      ? await supabase
          .from("messages")
          .select("conversation_id, created_at")
          .eq("is_internal_note", true)
          .is("deleted_at", null)
          .in("conversation_id", convIds)
      : { data: [] };
    const internalByConv = new Map<string, string[]>();
    (internalMsgs ?? []).forEach((m: any) => {
      const arr = internalByConv.get(m.conversation_id) ?? [];
      arr.push(m.created_at);
      internalByConv.set(m.conversation_id, arr);
    });

    const enriched = convList.map((c) => {
      const me = partMap.get(c.id);
      const lastRead = me?.last_read_at ? new Date(me.last_read_at).getTime() : 0;
      const internalDates = internalByConv.get(c.id) ?? [];
      const hasInternalUnread = internalDates.some((d) => new Date(d).getTime() > lastRead);
      return { ...c, myParticipant: me, hasInternalUnread };
    });

    setConversations(enriched);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [profile?.id]);

  const filtered = conversations.filter((c) => {
    if (search) {
      const haystack = `${c.client?.couple_name_1 ?? ""} ${c.client?.couple_name_2 ?? ""}`.toLowerCase();
      if (!haystack.includes(search.toLowerCase())) return false;
    }
    if (filter === "unread") {
      const lr = c.myParticipant?.last_read_at ? new Date(c.myParticipant.last_read_at).getTime() : 0;
      const lm = c.last_message_at ? new Date(c.last_message_at).getTime() : 0;
      if (lm <= lr) return false;
    }
    if (filter === "internal" && !c.hasInternalUnread) return false;
    return true;
  });

  const selectedConv = conversations.find((c) => c.id === selected) ?? null;
  const coupleName = (c: ConversationRow) =>
    `${c.client?.couple_name_1 ?? "—"}${c.client?.couple_name_2 ? " & " + c.client.couple_name_2 : ""}`;

  return (
    <div className="-mx-8 -my-8 h-[calc(100vh-4rem)] flex">
      {/* LEFT PANE */}
      <aside className="w-[320px] shrink-0 bg-background border-r border-primary/20 flex flex-col">
        <div className="bg-background border-b border-primary/20 p-4 space-y-3">
          <h1 className="font-serif italic text-[20px] text-primary">Conversations</h1>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search couples…"
              className="w-full pl-8 pr-2 py-1.5 bg-surface border border-primary/15 rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="flex gap-1.5">
            {([
              { v: "all", l: "All" },
              { v: "unread", l: "Unread" },
              { v: "internal", l: "Internal" },
            ] as const).map((opt) => (
              <button
                key={opt.v}
                onClick={() => setFilter(opt.v)}
                className={`px-2.5 py-1 rounded-full text-[11px] uppercase tracking-wider transition-colors ${
                  filter === opt.v ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground hover:text-primary"
                }`}
              >
                {opt.l}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="font-serif italic text-primary p-4">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="font-serif italic text-muted-foreground p-6 text-center">No conversations yet.</p>
          ) : (
            filtered.map((c) => {
              const lr = c.myParticipant?.last_read_at ? new Date(c.myParticipant.last_read_at).getTime() : 0;
              const lm = c.last_message_at ? new Date(c.last_message_at).getTime() : 0;
              const isUnread = lm > lr;
              const active = selected === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setSelected(c.id)}
                  className={`w-full text-left px-4 py-3 border-b border-border/40 transition-colors relative ${
                    active ? "bg-background-alt" : "hover:bg-background-alt/50"
                  }`}
                >
                  {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] bg-primary rounded-r" />}
                  <div className="flex items-start justify-between gap-2 mb-0.5">
                    <span className="font-serif italic text-[15px] text-primary truncate flex items-center gap-1.5">
                      {isUnread && <span className="h-2 w-2 rounded-full bg-magenta inline-block shrink-0" />}
                      {coupleName(c)}
                    </span>
                    <span className="text-[11px] text-muted-foreground shrink-0">
                      {c.last_message_at ? relativeTime(c.last_message_at) : ""}
                    </span>
                  </div>
                  <p className="text-[13px] text-foreground/80 truncate pr-2">
                    {c.last_message_preview ?? <span className="italic text-muted-foreground">No messages yet</span>}
                  </p>
                  {c.hasInternalUnread && (
                    <span className="inline-flex items-center gap-1 mt-1.5 text-[10px] uppercase tracking-wider text-gold">
                      <Lock size={9} /> Internal
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* RIGHT PANE */}
      <section className="flex-1 min-w-0 flex flex-col">
        {!selectedConv ? (
          <div className="flex-1 flex items-center justify-center bg-background">
            <div className="bg-surface rounded-lg shadow-soft px-12 py-16 text-center">
              <p className="font-serif italic text-[24px] text-primary">Select a conversation to begin.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="bg-surface border-b border-gold/40 px-6 py-4 flex items-center justify-between">
              <div>
                <Link
                  to="/studio/clients/$id"
                  params={{ id: selectedConv.client?.id ?? "" }}
                  className="font-serif italic text-[22px] text-primary hover:underline decoration-gold underline-offset-4"
                >
                  {coupleName(selectedConv)}
                </Link>
                {selectedConv.client?.wedding_date && (
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mt-0.5">
                    Wedding {new Date(selectedConv.client.wedding_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </p>
                )}
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <MessageThread conversationId={selectedConv.id} />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
