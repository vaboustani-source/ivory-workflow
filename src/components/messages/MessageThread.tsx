import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Lock, Send } from "lucide-react";
import { toast } from "sonner";

interface Message {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  content: string | null;
  is_internal_note: boolean;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  sender?: { full_name: string | null; role: string } | null;
}

interface Participant {
  user_id: string;
  role_in_conversation: string;
  user?: { full_name: string | null; email: string | null } | null;
}

const MONTHS = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
const WEEKDAYS = ["SUNDAY","MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY"];

function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function dayLabel(iso: string) {
  const d = new Date(iso);
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
function timeLabel(iso: string) {
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${m}${ampm}`;
}

export function MessageThread({
  conversationId,
  showHeader = false,
  coupleNames,
}: {
  conversationId: string;
  showHeader?: boolean;
  coupleNames?: string;
}) {
  const { profile } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [composerText, setComposerText] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const load = async () => {
    const [msgRes, partRes] = await Promise.all([
      supabase
        .from("messages")
        .select("id, conversation_id, sender_id, content, is_internal_note, created_at, edited_at, deleted_at, sender:profiles!messages_sender_id_fkey(full_name, role)")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(200),
      supabase
        .from("conversation_participants")
        .select("user_id, role_in_conversation, user:profiles!conversation_participants_user_id_fkey(full_name, email)")
        .eq("conversation_id", conversationId),
    ]);
    setMessages((msgRes.data ?? []) as unknown as Message[]);
    setParticipants((partRes.data ?? []) as unknown as Participant[]);
    setLoading(false);
  };

  // Mark read on mount & when messages change
  const markRead = async () => {
    if (!profile) return;
    await supabase
      .from("conversation_participants")
      .update({ last_read_at: new Date().toISOString() })
      .eq("conversation_id", conversationId)
      .eq("user_id", profile.id);
  };

  useEffect(() => {
    setLoading(true);
    load().then(() => markRead());
  }, [conversationId]);

  useEffect(() => {
    // Auto scroll to bottom when messages load/append
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, loading]);

  const handleSend = async () => {
    const content = composerText.trim();
    if (!content || !profile) return;
    setSending(true);
    const { data, error } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        sender_id: profile.id,
        content,
        is_internal_note: isInternal,
      })
      .select("id")
      .single();
    if (error) {
      toast.error("Failed to send: " + error.message);
      setSending(false);
      return;
    }
    setComposerText("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    // Fire-and-forget notification
    if (data?.id) {
      supabase.functions.invoke("send-message-notification", {
        body: { message_id: data.id },
      }).catch((err) => console.warn("notification failed", err));
    }

    await load();
    await markRead();
    setSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setComposerText(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  };

  // Group messages with day dividers
  const grouped: Array<{ type: "divider"; label: string; key: string } | { type: "message"; msg: Message }> = [];
  let lastDay: string | null = null;
  for (const m of messages) {
    const k = dayKey(m.created_at);
    if (k !== lastDay) {
      grouped.push({ type: "divider", label: dayLabel(m.created_at), key: "d-" + k });
      lastDay = k;
    }
    grouped.push({ type: "message", msg: m });
  }

  const visibleParticipants = participants.slice(0, 4);
  const extraCount = Math.max(0, participants.length - 4);

  return (
    <div className="flex flex-col h-full bg-background-alt">
      {showHeader && (
        <div className="bg-surface border-b border-gold/40 px-6 py-4 flex items-center justify-between">
          <div>
            {coupleNames && (
              <h3 className="font-serif italic text-[22px] text-primary leading-tight">{coupleNames}</h3>
            )}
          </div>
          <div className="flex -space-x-2">
            {visibleParticipants.map((p) => (
              <div
                key={p.user_id}
                className="h-8 w-8 rounded-full bg-plum text-background flex items-center justify-center text-xs ring-2 ring-surface"
                title={p.user?.full_name ?? p.user?.email ?? ""}
              >
                {(p.user?.full_name ?? "?").charAt(0).toUpperCase()}
              </div>
            ))}
            {extraCount > 0 && (
              <div className="h-8 px-2 rounded-full bg-muted-foreground/30 text-foreground text-xs flex items-center justify-center ring-2 ring-surface">
                +{extraCount}
              </div>
            )}
          </div>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
        {loading ? (
          <p className="font-serif italic text-primary text-center">Loading…</p>
        ) : grouped.length === 0 ? (
          <p className="font-serif italic text-muted-foreground text-center mt-12">No messages yet. Begin the conversation below.</p>
        ) : (
          grouped.map((item) => {
            if (item.type === "divider") {
              return (
                <div key={item.key} className="flex items-center gap-3 my-6">
                  <div className="flex-1 h-px bg-gold/40" />
                  <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{item.label}</span>
                  <div className="flex-1 h-px bg-gold/40" />
                </div>
              );
            }
            const m = item.msg;
            const isMine = m.sender_id === profile?.id;

            if (m.deleted_at) {
              return (
                <div key={m.id} className="text-center">
                  <span className="text-xs italic text-muted-foreground">Message removed</span>
                </div>
              );
            }

            if (m.is_internal_note) {
              return (
                <div key={m.id} className="bg-sage/15 border border-dashed border-gold rounded-md p-4 max-w-[90%] mx-auto">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5 text-gold">
                      <Lock size={11} />
                      <span className="text-[10px] uppercase tracking-[0.15em]">Internal — not visible to client</span>
                    </div>
                  </div>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                    {m.sender?.full_name ?? "—"} · {timeLabel(m.created_at)}
                    {m.edited_at && <span className="ml-1 normal-case">(edited)</span>}
                  </p>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{m.content}</p>
                </div>
              );
            }

            return (
              <div key={m.id} className={`flex gap-2 ${isMine ? "justify-end" : "justify-start"}`}>
                {!isMine && (
                  <div className="h-6 w-6 rounded-full bg-plum text-background flex items-center justify-center text-[10px] mt-5 shrink-0">
                    {(m.sender?.full_name ?? "?").charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="max-w-[70%]">
                  <p className={`text-[11px] uppercase tracking-wider text-muted-foreground mb-1 ${isMine ? "text-right" : ""}`}>
                    {m.sender?.full_name ?? "—"} · {timeLabel(m.created_at)}
                    {m.edited_at && <span className="ml-1 normal-case">(edited)</span>}
                  </p>
                  <div
                    className={`px-3 py-2.5 rounded-xl text-sm text-foreground whitespace-pre-wrap ${
                      isMine ? "bg-background-alt" : "bg-surface shadow-soft"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
                {isMine && (
                  <div className="h-6 w-6 rounded-full bg-plum text-background flex items-center justify-center text-[10px] mt-5 shrink-0">
                    {(profile?.full_name ?? "?").charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="bg-surface border-t border-gold/40 px-6 py-4">
        <div className="flex items-center gap-2 mb-2">
          <button
            type="button"
            onClick={() => setIsInternal(false)}
            className={`px-3 py-1 rounded-full text-xs uppercase tracking-wider transition-colors ${
              !isInternal ? "bg-magenta text-background" : "bg-background-alt text-muted-foreground hover:text-foreground"
            }`}
          >
            Public
          </button>
          <button
            type="button"
            onClick={() => setIsInternal(true)}
            className={`px-3 py-1 rounded-full text-xs uppercase tracking-wider transition-colors flex items-center gap-1 ${
              isInternal ? "bg-sage text-background" : "bg-background-alt text-muted-foreground hover:text-foreground"
            }`}
          >
            <Lock size={11} /> Internal note
          </button>
          <span className="text-[11px] text-muted-foreground ml-2">
            {isInternal ? "Internal: team only." : "Public: visible to client."}
          </span>
        </div>
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={composerText}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder="Write a message…"
            className="flex-1 resize-none px-3 py-2 bg-background-alt/40 border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!composerText.trim() || sending}
            className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-40 flex items-center gap-2"
          >
            <Send size={14} /> Send
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5">⌘/Ctrl + Enter to send</p>
      </div>
    </div>
  );
}
