import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useEffectiveScope } from "@/lib/view-as";
import { relativeTime, shortDate } from "@/lib/dates";
import { Search, Lock, X } from "lucide-react";
import { MessageThread } from "@/components/messages/MessageThread";

const searchSchema = z.object({
  conversation_id: z.string().uuid().optional(),
  message_id: z.string().uuid().optional(),
});

export const Route = createFileRoute("/studio/messages")({
  validateSearch: searchSchema,
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

interface MessageHit {
  id: string;
  conversation_id: string;
  content: string | null;
  created_at: string;
  sender_id: string | null;
  client_id: string;
  couple_name_1: string;
  couple_name_2: string | null;
  sender_name: string | null;
}

type Filter = "all" | "unread" | "internal";

function highlightMatch(text: string, query: string) {
  if (!query.trim()) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(re);
  return parts.map((p, i) =>
    p.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="bg-gold/30 text-foreground rounded-sm px-0.5">{p}</mark>
      : <span key={i}>{p}</span>
  );
}

function snippet(content: string, query: string, max = 120): string {
  if (!query.trim()) return content.slice(0, max);
  const idx = content.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return content.slice(0, max);
  const start = Math.max(0, idx - 30);
  const end = Math.min(content.length, idx + query.length + max - 30);
  return (start > 0 ? "…" : "") + content.slice(start, end) + (end < content.length ? "…" : "");
}

function MessagesPage() {
  const { profile } = useAuth();
  const { scopeClientIds } = useEffectiveScope();
  const navigate = useNavigate({ from: "/studio/messages" });
  const search = Route.useSearch();
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [selected, setSelected] = useState<string | null>(search.conversation_id ?? null);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(search.message_id ?? null);
  const [searchText, setSearchText] = useState("");
  const [debounced, setDebounced] = useState("");
  const [messageHits, setMessageHits] = useState<MessageHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);

  // Sync from URL search params
  useEffect(() => {
    if (search.conversation_id) setSelected(search.conversation_id);
    if (search.message_id) setHighlightMessageId(search.message_id);
  }, [search.conversation_id, search.message_id]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  // Debounce search text
  useEffect(() => {
    const t = setTimeout(() => setDebounced(searchText.trim()), 300);
    return () => clearTimeout(t);
  }, [searchText]);

  // Run message-content search when debounced query active
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!debounced) {
        setMessageHits([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      // websearch_to_tsquery via textSearch
      const { data, error } = await supabase
        .from("messages")
        .select("id, conversation_id, content, created_at, sender_id, conversation:conversations!inner(client_id, client:clients!inner(id, couple_name_1, couple_name_2)), sender:profiles(full_name)")
        .textSearch("content_tsv", debounced, { type: "websearch", config: "english" })
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(20);
      if (cancelled) return;
      if (error) {
        console.warn("message search error", error);
        setMessageHits([]);
      } else {
        const hits: MessageHit[] = (data ?? []).map((row: any) => ({
          id: row.id,
          conversation_id: row.conversation_id,
          content: row.content,
          created_at: row.created_at,
          sender_id: row.sender_id,
          client_id: row.conversation?.client_id,
          couple_name_1: row.conversation?.client?.couple_name_1 ?? "—",
          couple_name_2: row.conversation?.client?.couple_name_2 ?? null,
          sender_name: row.sender?.full_name ?? null,
        }));
        setMessageHits(hits);
      }
      setSearching(false);
    })();
    return () => { cancelled = true; };
  }, [debounced]);

  const coupleName = (c: ConversationRow) =>
    `${c.client?.couple_name_1 ?? "—"}${c.client?.couple_name_2 ? " & " + c.client.couple_name_2 : ""}`;

  // Couple-name filtering for left pane (when search active)
  const coupleMatches = useMemo(() => {
    if (!debounced) return [] as ConversationRow[];
    const q = debounced.toLowerCase();
    return conversations.filter((c) => {
      const h = `${c.client?.couple_name_1 ?? ""} ${c.client?.couple_name_2 ?? ""}`.toLowerCase();
      return h.includes(q);
    });
  }, [debounced, conversations]);

  // Normal filtered list (no search)
  const filtered = conversations.filter((c) => {
    if (filter === "unread") {
      const lr = c.myParticipant?.last_read_at ? new Date(c.myParticipant.last_read_at).getTime() : 0;
      const lm = c.last_message_at ? new Date(c.last_message_at).getTime() : 0;
      if (lm <= lr) return false;
    }
    if (filter === "internal" && !c.hasInternalUnread) return false;
    return true;
  });

  const selectedConv = conversations.find((c) => c.id === selected) ?? null;

  const openConversation = (convId: string, messageId?: string) => {
    setSelected(convId);
    setHighlightMessageId(messageId ?? null);
    navigate({
      search: messageId
        ? { conversation_id: convId, message_id: messageId }
        : { conversation_id: convId },
      replace: true,
    });
  };

  const isSearchActive = debounced.length > 0;

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
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search couples or messages…"
              className="w-full pl-8 pr-8 py-1.5 bg-surface border border-primary/15 rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            {searchText && (
              <button
                type="button"
                onClick={() => setSearchText("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary"
                aria-label="Clear search"
              >
                <X size={13} />
              </button>
            )}
          </div>
          {!isSearchActive && (
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
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="font-serif italic text-primary p-4">Loading…</p>
          ) : isSearchActive ? (
            <SearchResultsPane
              query={debounced}
              searching={searching}
              coupleMatches={coupleMatches}
              messageHits={messageHits}
              selected={selected}
              onOpenConversation={openConversation}
              coupleName={coupleName}
            />
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
                  onClick={() => openConversation(c.id)}
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
              <MessageThread
                key={selectedConv.id}
                conversationId={selectedConv.id}
                highlightMessageId={highlightMessageId}
              />
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function SearchResultsPane({
  query,
  searching,
  coupleMatches,
  messageHits,
  selected,
  onOpenConversation,
  coupleName,
}: {
  query: string;
  searching: boolean;
  coupleMatches: ConversationRow[];
  messageHits: MessageHit[];
  selected: string | null;
  onOpenConversation: (convId: string, messageId?: string) => void;
  coupleName: (c: ConversationRow) => string;
}) {
  const nothing = !searching && coupleMatches.length === 0 && messageHits.length === 0;

  return (
    <div>
      {coupleMatches.length > 0 && (
        <div>
          <div className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Couples</div>
          {coupleMatches.map((c) => {
            const active = selected === c.id;
            return (
              <button
                key={c.id}
                onClick={() => onOpenConversation(c.id)}
                className={`w-full text-left px-4 py-3 border-b border-border/40 transition-colors relative ${
                  active ? "bg-background-alt" : "hover:bg-background-alt/50"
                }`}
              >
                {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] bg-primary rounded-r" />}
                <div className="font-serif italic text-[15px] text-primary truncate">
                  {highlightMatch(coupleName(c), query)}
                </div>
                <p className="text-[12px] text-muted-foreground truncate">
                  {c.last_message_preview ?? <span className="italic">No messages yet</span>}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {messageHits.length > 0 && (
        <div>
          <div className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Messages</div>
          {messageHits.map((h) => {
            const couple = `${h.couple_name_1}${h.couple_name_2 ? " & " + h.couple_name_2 : ""}`;
            const sn = h.content ? snippet(h.content, query) : "";
            return (
              <button
                key={h.id}
                onClick={() => onOpenConversation(h.conversation_id, h.id)}
                className="w-full text-left px-4 py-3 border-b border-border/40 hover:bg-background-alt/50 transition-colors"
              >
                <div className="font-serif italic text-[14px] text-primary truncate">{couple}</div>
                <p className="text-[12px] text-foreground/80 mt-0.5 line-clamp-2 leading-snug">
                  {highlightMatch(sn, query)}
                </p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
                  {h.sender_name ?? "—"} · {relativeTime(h.created_at)}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {searching && (
        <p className="px-4 py-6 font-serif italic text-muted-foreground text-sm">Searching…</p>
      )}

      {nothing && (
        <div className="px-4 py-10 text-center">
          <p className="font-serif italic text-muted-foreground">No matches for “{query}”</p>
          <p className="text-[11px] text-muted-foreground mt-1">Try different keywords.</p>
        </div>
      )}
    </div>
  );
}
