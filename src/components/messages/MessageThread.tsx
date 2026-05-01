import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Lock, Send, Paperclip, X, FileText, Image as ImageIcon, Download, ChevronLeft, ChevronRight, Search, ChevronUp, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import type { RealtimeChannel } from "@supabase/supabase-js";

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
  user?: { full_name: string | null; email: string | null; role?: string } | null;
}

interface Attachment {
  id: string;
  message_id: string;
  file_name: string;
  file_url: string;
  thumbnail_url: string | null;
  storage_path: string;
  file_size_bytes: number | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
}

interface ReadRow { message_id: string; user_id: string; read_at: string; }
interface MentionRow { message_id: string; mentioned_user_id: string; }

interface PendingFile {
  localId: string;
  file: File;
  previewUrl?: string;
  uploading: boolean;
  uploaded: boolean;
  tempPath?: string;
  error?: string;
}

const MONTHS = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
const WEEKDAYS = ["SUNDAY","MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY"];
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIME = [
  "image/png","image/jpeg","image/gif","image/webp","image/heic","image/svg+xml",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain","text/csv",
];

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
function fmtBytes(b: number | null | undefined) {
  if (!b && b !== 0) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}
function uuid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function firstNameOf(full?: string | null) {
  return (full ?? "").split(" ")[0] ?? "";
}

// Render text with @mentions as gold pills, optionally highlighting query matches in gold.
function renderMessageContent(content: string, highlightQuery?: string): React.ReactNode {
  const parts = content.split(/(@[A-Za-z][A-Za-z0-9_-]*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("@") && p.length > 1) {
      return (
        <span
          key={i}
          className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-gold bg-gold/15 font-medium text-[13px]"
        >
          {p}
        </span>
      );
    }
    if (highlightQuery && highlightQuery.trim()) return <span key={i}>{highlightText(p, highlightQuery)}</span>;
    return <span key={i}>{p}</span>;
  });
}

function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(${escaped})`, "gi");
  const segs = text.split(re);
  return segs.map((s, i) =>
    re.test(s) && s.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="bg-gold/35 text-foreground rounded-sm px-0.5">{s}</mark>
      : <span key={i}>{s}</span>
  );
}

export function MessageThread({
  conversationId,
  showHeader = false,
  coupleNames,
  highlightMessageId,
  enableInThreadSearch = false,
}: {
  conversationId: string;
  showHeader?: boolean;
  coupleNames?: string;
  highlightMessageId?: string | null;
  enableInThreadSearch?: boolean;
}) {
  const { profile } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [reads, setReads] = useState<ReadRow[]>([]);
  const [mentions, setMentions] = useState<MentionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [composerText, setComposerText] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [connected, setConnected] = useState<"connected" | "reconnecting" | "offline">("reconnecting");
  const [lightbox, setLightbox] = useState<{ images: Attachment[]; index: number } | null>(null);
  const [showJump, setShowJump] = useState(false);
  const [mentionPopover, setMentionPopover] = useState<{ open: boolean; query: string; index: number }>({ open: false, query: "", index: 0 });

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const presenceChannelRef = useRef<RealtimeChannel | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const messageRefs = useRef<Map<string, HTMLElement>>(new Map());
  const isAtBottomRef = useRef(true);
  const initialReadBatchedRef = useRef(false);

  const profileMap = useMemo(() => {
    const m = new Map<string, Participant["user"]>();
    participants.forEach((p) => m.set(p.user_id, p.user ?? null));
    return m;
  }, [participants]);

  const isStudio = profile?.role === "owner" || profile?.role === "studio_manager" || profile?.role === "associate_photographer";

  // ---------- LOAD ----------
  const load = useCallback(async () => {
    if (!conversationId) return;
    const [msgRes, partRes] = await Promise.all([
      supabase
        .from("messages")
        .select("id, conversation_id, sender_id, content, is_internal_note, created_at, edited_at, deleted_at, sender:profiles!messages_sender_id_fkey(full_name, role)")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(200),
      supabase
        .from("conversation_participants")
        .select("user_id, role_in_conversation, user:profiles!conversation_participants_user_id_fkey(full_name, email, role)")
        .eq("conversation_id", conversationId),
    ]);
    const msgs = (msgRes.data ?? []) as unknown as Message[];
    setMessages(msgs);
    setParticipants((partRes.data ?? []) as unknown as Participant[]);

    const ids = msgs.map((m) => m.id);
    if (ids.length > 0) {
      const [aRes, rRes, mRes] = await Promise.all([
        supabase.from("message_attachments").select("id, message_id, file_name, file_url, thumbnail_url, storage_path, file_size_bytes, mime_type, width, height").in("message_id", ids),
        supabase.from("message_reads").select("message_id, user_id, read_at").in("message_id", ids),
        supabase.from("message_mentions").select("message_id, mentioned_user_id").in("message_id", ids),
      ]);
      setAttachments((aRes.data ?? []) as unknown as Attachment[]);
      setReads((rRes.data ?? []) as unknown as ReadRow[]);
      setMentions((mRes.data ?? []) as unknown as MentionRow[]);
    } else {
      setAttachments([]); setReads([]); setMentions([]);
    }
    setLoading(false);
  }, [conversationId]);

  const markRead = useCallback(async () => {
    if (!profile) return;
    await supabase
      .from("conversation_participants")
      .update({ last_read_at: new Date().toISOString() })
      .eq("conversation_id", conversationId)
      .eq("user_id", profile.id);
  }, [conversationId, profile]);

  useEffect(() => {
    setLoading(true);
    initialReadBatchedRef.current = false;
    load().then(() => markRead());
  }, [conversationId, load, markRead]);

  // ---------- REALTIME: messages, reads, mentions ----------
  useEffect(() => {
    if (!conversationId || !profile) return;
    setConnected("reconnecting");

    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        async (payload) => {
          const newRow = payload.new as Message;
          setMessages((prev) => prev.some((m) => m.id === newRow.id) ? prev : [...prev, newRow]);
          // Hydrate sender info if missing
          if (newRow.sender_id && !profileMap.get(newRow.sender_id)) {
            const { data } = await supabase.from("profiles").select("full_name, role").eq("id", newRow.sender_id).maybeSingle();
            if (data) {
              setMessages((prev) => prev.map((m) => m.id === newRow.id ? { ...m, sender: { full_name: data.full_name, role: data.role } } : m));
            }
          }
          // Fetch attachments for the new message
          const { data: a } = await supabase
            .from("message_attachments")
            .select("id, message_id, file_name, file_url, thumbnail_url, storage_path, file_size_bytes, mime_type, width, height")
            .eq("message_id", newRow.id);
          if (a && a.length) setAttachments((prev) => [...prev, ...(a as unknown as Attachment[])]);
        })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const u = payload.new as Message;
          setMessages((prev) => prev.map((m) => m.id === u.id ? { ...m, content: u.content, edited_at: u.edited_at, deleted_at: u.deleted_at } : m));
        })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "message_reads" },
        (payload) => {
          const r = payload.new as ReadRow;
          setReads((prev) => prev.some((x) => x.message_id === r.message_id && x.user_id === r.user_id) ? prev : [...prev, r]);
        })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setConnected("connected");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setConnected("offline");
        else setConnected("reconnecting");
      });

    return () => { supabase.removeChannel(channel); };
  }, [conversationId, profile, profileMap]);

  // ---------- PRESENCE: typing ----------
  useEffect(() => {
    if (!conversationId || !profile) return;
    const channel = supabase.channel(`presence:${conversationId}`, {
      config: { presence: { key: profile.id } },
    });
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState() as Record<string, Array<{ typing?: boolean; name?: string }>>;
      const typing = Object.entries(state)
        .filter(([uid, metas]) => uid !== profile.id && (metas?.[0] as any)?.typing)
        .map(([, metas]) => (metas[0] as any)?.name as string)
        .filter(Boolean);
      setTypingUsers(typing);
    }).subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ typing: false, name: firstNameOf(profile.full_name) });
      }
    });
    presenceChannelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      presenceChannelRef.current = null;
    };
  }, [conversationId, profile]);

  const broadcastTyping = useCallback(async (typing: boolean) => {
    const ch = presenceChannelRef.current;
    if (!ch || !profile) return;
    isTypingRef.current = typing;
    await ch.track({ typing, name: firstNameOf(profile.full_name) });
  }, [profile]);

  // ---------- AUTOSCROLL ----------
  const handleScrollAreaScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    isAtBottomRef.current = atBottom;
    setShowJump(!atBottom);
  };

  useEffect(() => {
    if (!scrollRef.current) return;
    if (isAtBottomRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, loading]);

  // ---------- READ RECEIPTS via IntersectionObserver ----------
  useEffect(() => {
    if (loading || !profile) return;
    const myReads = new Set(reads.filter((r) => r.user_id === profile.id).map((r) => r.message_id));
    const unreadVisibleIds = messages
      .filter((m) => !m.deleted_at && m.sender_id !== profile.id && !myReads.has(m.id))
      .map((m) => m.id);

    // Initial batch: after 2s, mark all currently-loaded unread as read
    if (!initialReadBatchedRef.current && unreadVisibleIds.length > 0) {
      initialReadBatchedRef.current = true;
      const t = setTimeout(async () => {
        const rows = unreadVisibleIds.map((id) => ({ message_id: id, user_id: profile.id }));
        const { error } = await supabase.from("message_reads").upsert(rows, { onConflict: "message_id,user_id", ignoreDuplicates: true });
        if (error) console.warn("read receipts batch failed", error);
      }, 2000);
      return () => clearTimeout(t);
    }

    // Observer for messages that arrive after initial load
    if (observerRef.current) observerRef.current.disconnect();
    const obs = new IntersectionObserver(async (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const id = e.target.getAttribute("data-message-id");
        if (!id || !unreadVisibleIds.includes(id)) continue;
        await supabase.from("message_reads").upsert({ message_id: id, user_id: profile.id }, { onConflict: "message_id,user_id", ignoreDuplicates: true });
      }
    }, { threshold: 0.5 });
    observerRef.current = obs;
    unreadVisibleIds.forEach((id) => {
      const el = messageRefs.current.get(id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, [messages, reads, loading, profile]);

  // ---------- FILE ATTACHMENTS ----------
  const validateFile = (f: File): string | null => {
    if (f.size > MAX_FILE_BYTES) return `${f.name}: too large (max 25 MB)`;
    if (!ALLOWED_MIME.includes(f.type)) return `${f.name}: type not allowed`;
    return null;
  };

  const uploadPending = async (pf: PendingFile) => {
    const tempPath = `${conversationId}/temp/${pf.localId}/${pf.file.name}`;
    const { error } = await supabase.storage
      .from("message-attachments")
      .upload(tempPath, pf.file, { contentType: pf.file.type, upsert: false });
    if (error) {
      setPending((prev) => prev.map((p) => p.localId === pf.localId ? { ...p, uploading: false, error: error.message } : p));
      toast.error(`${pf.file.name}: ${error.message}`);
      return;
    }
    setPending((prev) => prev.map((p) => p.localId === pf.localId ? { ...p, uploading: false, uploaded: true, tempPath } : p));
  };

  const handleFiles = (files: FileList | File[]) => {
    const arr = Array.from(files).slice(0, 5);
    const accepted: PendingFile[] = [];
    arr.forEach((f) => {
      const err = validateFile(f);
      if (err) { toast.error(err); return; }
      const localId = uuid();
      accepted.push({
        localId,
        file: f,
        previewUrl: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined,
        uploading: true,
        uploaded: false,
      });
    });
    if (accepted.length === 0) return;
    setPending((prev) => [...prev, ...accepted]);
    accepted.forEach(uploadPending);
  };

  const removePending = async (localId: string) => {
    const item = pending.find((p) => p.localId === localId);
    setPending((prev) => prev.filter((p) => p.localId !== localId));
    if (item?.tempPath) {
      await supabase.storage.from("message-attachments").remove([item.tempPath]).catch(() => {});
    }
    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
  };

  // ---------- SEND ----------
  const handleSend = async () => {
    const content = composerText.trim();
    if ((!content && pending.length === 0) || !profile) return;
    if (pending.some((p) => p.uploading)) {
      toast.info("Wait for uploads to finish.");
      return;
    }
    setSending(true);
    broadcastTyping(false);

    const { data: msgRow, error } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        sender_id: profile.id,
        content: content || null,
        is_internal_note: isInternal,
      })
      .select("id")
      .single();
    if (error || !msgRow) {
      toast.error("Failed to send: " + (error?.message ?? "unknown"));
      setSending(false);
      return;
    }
    const messageId = msgRow.id;

    // Finalize uploaded files: copy temp -> permanent path, insert row, delete temp.
    // (Using copy+remove instead of move() because storage.objects has no UPDATE policy
    //  for this bucket — move() would fail silently with "Object not found".)
    for (const pf of pending) {
      if (!pf.uploaded || !pf.tempPath) continue;
      const finalPath = `${conversationId}/${messageId}/${pf.file.name}`;

      // 1) Copy temp -> final
      const { error: copyErr } = await supabase.storage
        .from("message-attachments")
        .copy(pf.tempPath, finalPath);
      if (copyErr) {
        console.error("attachment copy failed", copyErr);
        toast.error(`Couldn't attach ${pf.file.name}: ${copyErr.message}`);
        continue;
      }

      // 2) Build URLs
      const { data: signed, error: signErr } = await supabase.storage
        .from("message-attachments")
        .createSignedUrl(finalPath, 60 * 60 * 24 * 7);
      if (signErr || !signed?.signedUrl) {
        console.error("sign url failed", signErr);
        toast.error(`Couldn't link ${pf.file.name}: ${signErr?.message ?? "no url"}`);
        continue;
      }
      const isImage = pf.file.type.startsWith("image/");
      const { data: thumb } = isImage
        ? await supabase.storage
            .from("message-attachments")
            .createSignedUrl(finalPath, 60 * 60 * 24 * 7, { transform: { width: 400, quality: 75 } })
        : { data: null as any };

      // 3) Read image dimensions (best-effort) before revoking the preview URL
      let dims: { width: number | null; height: number | null } = { width: null, height: null };
      if (isImage && pf.previewUrl) {
        dims = await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
          img.onerror = () => resolve({ width: null, height: null });
          img.src = pf.previewUrl!;
        });
      }

      // 4) Insert attachment row
      const { error: insErr } = await supabase.from("message_attachments").insert({
        message_id: messageId,
        file_name: pf.file.name,
        file_url: signed.signedUrl,
        thumbnail_url: thumb?.signedUrl ?? null,
        storage_path: finalPath,
        file_size_bytes: pf.file.size,
        mime_type: pf.file.type,
        width: dims.width,
        height: dims.height,
        uploaded_by: profile.id,
      });
      if (insErr) {
        console.error("attachment row insert failed", insErr);
        toast.error(`Couldn't save ${pf.file.name}: ${insErr.message}`);
        // Roll back the copied file so we don't orphan it
        await supabase.storage.from("message-attachments").remove([finalPath]).catch(() => {});
        continue;
      }

      // 5) Delete the temp file (best-effort; orphan cleanup will get it otherwise)
      await supabase.storage.from("message-attachments").remove([pf.tempPath]).catch(() => {});

      if (pf.previewUrl) URL.revokeObjectURL(pf.previewUrl);
    }

    // Parse @mentions: match against participant first names
    if (content) {
      const matches = Array.from(content.matchAll(/@([A-Za-z][A-Za-z0-9_-]*)/g)).map((m) => m[1].toLowerCase());
      if (matches.length > 0) {
        const rows = participants
          .filter((p) => p.user_id !== profile.id)
          .filter((p) => matches.includes(firstNameOf(p.user?.full_name).toLowerCase()))
          .map((p) => ({ message_id: messageId, mentioned_user_id: p.user_id }));
        if (rows.length > 0) {
          await supabase.from("message_mentions").upsert(rows, { onConflict: "message_id,mentioned_user_id", ignoreDuplicates: true });
        }
      }
    }

    setComposerText("");
    setPending([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    // Fire-and-forget notification (DB webhook is the primary path; this is defensive)
    supabase.functions.invoke("send-message-notification", { body: { message_id: messageId } }).catch(() => {});

    isAtBottomRef.current = true;
    await load();
    await markRead();
    setSending(false);
  };

  // ---------- COMPOSER HANDLERS ----------
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionPopover.open) {
      if (e.key === "Escape") { setMentionPopover({ open: false, query: "", index: 0 }); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionPopover((p) => ({ ...p, index: p.index + 1 })); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMentionPopover((p) => ({ ...p, index: Math.max(0, p.index - 1) })); return; }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applyMentionAt(mentionPopover.index);
        return;
      }
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setComposerText(val);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";

    // Typing
    if (!isTypingRef.current && val.length > 0) broadcastTyping(true);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => broadcastTyping(false), 1500);

    // Mentions: detect @token at cursor
    const caret = ta.selectionStart;
    const before = val.slice(0, caret);
    const m = before.match(/@([A-Za-z0-9_-]*)$/);
    if (m) setMentionPopover({ open: true, query: m[1].toLowerCase(), index: 0 });
    else if (mentionPopover.open) setMentionPopover({ open: false, query: "", index: 0 });
  };

  const filteredMentionParticipants = useMemo(() => {
    if (!mentionPopover.open) return [];
    return participants
      .filter((p) => p.user_id !== profile?.id)
      .filter((p) => firstNameOf(p.user?.full_name).toLowerCase().startsWith(mentionPopover.query))
      .slice(0, 5);
  }, [mentionPopover, participants, profile]);

  const applyMentionAt = (idx: number) => {
    const list = filteredMentionParticipants;
    if (list.length === 0) { setMentionPopover({ open: false, query: "", index: 0 }); return; }
    const choice = list[Math.min(idx, list.length - 1)];
    const fname = firstNameOf(choice.user?.full_name);
    const ta = textareaRef.current;
    if (!ta) return;
    const caret = ta.selectionStart;
    const before = composerText.slice(0, caret);
    const after = composerText.slice(caret);
    const replaced = before.replace(/@([A-Za-z0-9_-]*)$/, `@${fname} `);
    const next = replaced + after;
    setComposerText(next);
    setMentionPopover({ open: false, query: "", index: 0 });
    requestAnimationFrame(() => {
      ta.focus();
      const pos = replaced.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  // ---------- DRAG / DROP ----------
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  };

  // ---------- DERIVED ----------
  const grouped: Array<{ type: "divider"; label: string; key: string } | { type: "message"; msg: Message }> = [];
  let lastDay: string | null = null;
  for (const m of messages) {
    const k = dayKey(m.created_at);
    if (k !== lastDay) { grouped.push({ type: "divider", label: dayLabel(m.created_at), key: "d-" + k }); lastDay = k; }
    grouped.push({ type: "message", msg: m });
  }

  const visibleParticipants = participants.slice(0, 4);
  const extraCount = Math.max(0, participants.length - 4);

  const attachmentsByMsg = useMemo(() => {
    const map = new Map<string, Attachment[]>();
    attachments.forEach((a) => {
      const arr = map.get(a.message_id) ?? [];
      arr.push(a); map.set(a.message_id, arr);
    });
    return map;
  }, [attachments]);

  const readsByMsg = useMemo(() => {
    const map = new Map<string, ReadRow[]>();
    reads.forEach((r) => {
      const arr = map.get(r.message_id) ?? [];
      arr.push(r); map.set(r.message_id, arr);
    });
    return map;
  }, [reads]);

  const renderAttachments = (msgId: string, internal: boolean) => {
    const list = attachmentsByMsg.get(msgId) ?? [];
    if (list.length === 0) return null;
    const images = list.filter((a) => a.mime_type?.startsWith("image/"));
    const others = list.filter((a) => !a.mime_type?.startsWith("image/"));
    return (
      <div className="mt-2 space-y-2">
        {images.length > 0 && (
          <div className={`grid gap-1.5 ${images.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
            {images.slice(0, 4).map((img, i) => (
              <button
                key={img.id}
                type="button"
                onClick={() => setLightbox({ images, index: i })}
                className="relative overflow-hidden rounded-md border border-gold/30 bg-background-alt"
                style={{ maxWidth: 320 }}
              >
                <img
                  src={img.thumbnail_url ?? img.file_url}
                  alt={img.file_name}
                  className="w-full h-auto block"
                  loading="lazy"
                />
                {i === 3 && images.length > 4 && (
                  <div className="absolute inset-0 bg-plum/70 flex items-center justify-center text-background text-sm font-medium">
                    +{images.length - 4} more
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
        {others.map((a) => (
          <a
            key={a.id}
            href={a.file_url}
            target="_blank"
            rel="noreferrer"
            className={`flex items-center gap-2 px-3 py-2 rounded-md border ${internal ? "border-gold/40 bg-sage/10" : "border-gold/30 bg-background-alt"} hover:bg-gold/10 transition-colors`}
          >
            <FileText size={16} className="text-gold shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-foreground truncate">{a.file_name}</p>
              <p className="text-[11px] text-muted-foreground">{fmtBytes(a.file_size_bytes)}</p>
            </div>
            <Download size={14} className="text-muted-foreground" />
          </a>
        ))}
      </div>
    );
  };

  const renderReadReceipts = (msg: Message, mine: boolean) => {
    const rs = (readsByMsg.get(msg.id) ?? []).filter((r) => r.user_id !== profile?.id);
    if (rs.length === 0) return null;
    const visible = rs.slice(0, 4);
    const extra = Math.max(0, rs.length - 4);
    return (
      <div className={`flex items-center gap-1 mt-1 ${mine ? "justify-end" : "justify-start"}`}>
        <div className="flex -space-x-1.5" title={rs.map((r) => `${profileMap.get(r.user_id)?.full_name ?? "—"} · ${timeLabel(r.read_at)}`).join("\n")}>
          {visible.map((r) => (
            <div key={r.user_id} className="h-4 w-4 rounded-full bg-plum text-background flex items-center justify-center text-[8px] ring-1 ring-surface">
              {firstNameOf(profileMap.get(r.user_id)?.full_name).charAt(0).toUpperCase()}
            </div>
          ))}
          {extra > 0 && (
            <div className="h-4 px-1 rounded-full bg-muted text-foreground text-[8px] flex items-center justify-center ring-1 ring-surface">+{extra}</div>
          )}
        </div>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">read</span>
      </div>
    );
  };

  const connectionDot =
    connected === "connected" ? "bg-sage" : connected === "reconnecting" ? "bg-gold" : "bg-magenta";
  const connectionLabel =
    connected === "connected" ? "Connected" : connected === "reconnecting" ? "Reconnecting…" : "Offline — messages won't update live";

  // ---------- RENDER ----------
  return (
    <div className="flex flex-col h-full bg-background-alt relative">
      {showHeader && (
        <div className="bg-surface border-b border-gold/40 px-6 py-4 flex items-center justify-between">
          <div>
            {coupleNames && (
              <h3 className="font-serif italic text-[22px] text-primary leading-tight">{coupleNames}</h3>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className={`h-2 w-2 rounded-full ${connectionDot}`} title={connectionLabel} />
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
        </div>
      )}

      {!showHeader && (
        <div className="absolute top-2 right-3 z-10">
          <span className={`h-2 w-2 rounded-full ${connectionDot} inline-block`} title={connectionLabel} />
        </div>
      )}

      <div ref={scrollRef} onScroll={handleScrollAreaScroll} className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
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

            const setRef = (el: HTMLElement | null) => {
              if (el) messageRefs.current.set(m.id, el);
              else messageRefs.current.delete(m.id);
            };

            if (m.is_internal_note) {
              return (
                <div key={m.id} ref={setRef} data-message-id={m.id} className="bg-sage/15 border border-dashed border-gold rounded-md p-4 max-w-[90%] mx-auto">
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
                  {m.content && <p className="text-sm text-foreground whitespace-pre-wrap">{renderMessageContent(m.content)}</p>}
                  {renderAttachments(m.id, true)}
                  {renderReadReceipts(m, isMine)}
                </div>
              );
            }

            return (
              <div key={m.id} ref={setRef} data-message-id={m.id} className={`flex gap-2 ${isMine ? "justify-end" : "justify-start"}`}>
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
                    className={`px-3 py-2.5 rounded-xl text-sm text-foreground whitespace-pre-wrap bg-surface shadow-soft ${
                      isMine ? "border border-gold/30" : ""
                    }`}
                  >
                    {m.content && renderMessageContent(m.content)}
                    {renderAttachments(m.id, false)}
                  </div>
                  {renderReadReceipts(m, isMine)}
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

      {showJump && (
        <button
          type="button"
          onClick={() => {
            if (scrollRef.current) {
              scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
              isAtBottomRef.current = true;
              setShowJump(false);
            }
          }}
          className="absolute bottom-32 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs px-3 py-1.5 rounded-full shadow-elevated hover:opacity-90"
        >
          ↓ New messages
        </button>
      )}

      {/* Typing indicator */}
      {typingUsers.length > 0 && (
        <div className="px-6 pb-1 text-[12px] italic text-muted-foreground">
          {typingUsers.length === 1 && `${typingUsers[0]} is typing`}
          {typingUsers.length === 2 && `${typingUsers[0]} and ${typingUsers[1]} are typing`}
          {typingUsers.length >= 3 && `Several people are typing`}
          <span className="ml-1 inline-block animate-pulse">…</span>
        </div>
      )}

      {/* Composer */}
      <div
        className={`bg-surface border-t border-gold/40 px-6 py-4 relative ${dragOver ? "outline outline-2 outline-dashed outline-gold" : ""}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {dragOver && (
          <div className="absolute inset-0 bg-gold/10 flex items-center justify-center pointer-events-none z-10">
            <span className="font-serif italic text-primary text-lg">Drop to attach</span>
          </div>
        )}

        <div className="flex items-center gap-2 mb-2">
          {isStudio && (
            <>
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
            </>
          )}
          <span className="text-[11px] text-muted-foreground ml-2">
            {isInternal ? "Internal: team only." : "Public: visible to client."}
          </span>
        </div>

        {/* Pending attachments */}
        {pending.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {pending.map((p) => (
              <div key={p.localId} className="relative group flex items-center gap-2 bg-background-alt border border-border rounded-md p-1.5 pr-2">
                {p.previewUrl ? (
                  <img src={p.previewUrl} alt={p.file.name} className="h-12 w-12 object-cover rounded-sm" />
                ) : (
                  <div className="h-12 w-12 rounded-sm bg-surface border border-border flex items-center justify-center">
                    {p.file.type.startsWith("image/") ? <ImageIcon size={18} className="text-gold" /> : <FileText size={18} className="text-gold" />}
                  </div>
                )}
                <div className="text-[11px] max-w-[140px]">
                  <p className="truncate text-foreground">{p.file.name}</p>
                  <p className="text-muted-foreground">
                    {p.uploading ? "Uploading…" : p.error ? <span className="text-magenta">{p.error}</span> : fmtBytes(p.file.size)}
                  </p>
                </div>
                <button type="button" onClick={() => removePending(p.localId)} className="text-muted-foreground hover:text-magenta" aria-label="Remove">
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2 relative">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="h-9 w-9 flex items-center justify-center rounded-md bg-background-alt text-muted-foreground hover:text-primary"
            aria-label="Attach files"
          >
            <Paperclip size={16} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ALLOWED_MIME.join(",")}
            className="hidden"
            onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ""; }}
          />

          <textarea
            ref={textareaRef}
            value={composerText}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            onBlur={() => broadcastTyping(false)}
            rows={1}
            placeholder="Write a message…"
            className="flex-1 resize-none px-3 py-2 bg-background-alt/40 border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={(!composerText.trim() && pending.length === 0) || sending}
            className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-40 flex items-center gap-2"
          >
            <Send size={14} /> Send
          </button>

          {/* Mention popover */}
          {mentionPopover.open && filteredMentionParticipants.length > 0 && (
            <div className="absolute bottom-full left-12 mb-2 bg-surface border border-gold/40 rounded-md shadow-elevated min-w-[220px] py-1 z-20">
              {filteredMentionParticipants.map((p, i) => {
                const active = i === Math.min(mentionPopover.index, filteredMentionParticipants.length - 1);
                return (
                  <button
                    key={p.user_id}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); applyMentionAt(i); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left ${active ? "bg-background-alt" : "hover:bg-background-alt/60"}`}
                  >
                    <div className="h-6 w-6 rounded-full bg-plum text-background flex items-center justify-center text-[10px]">
                      {(p.user?.full_name ?? "?").charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground truncate">{p.user?.full_name ?? "—"}</p>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{p.user?.role ?? p.role_in_conversation}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5">⌘/Ctrl + Enter to send · @ to mention</p>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-50 bg-plum/90 flex items-center justify-center" onClick={() => setLightbox(null)}>
          <button className="absolute top-6 right-6 text-background hover:text-gold" onClick={() => setLightbox(null)} aria-label="Close">
            <X size={24} />
          </button>
          {lightbox.images.length > 1 && (
            <>
              <button
                className="absolute left-4 text-background hover:text-gold"
                onClick={(e) => { e.stopPropagation(); setLightbox((l) => l ? { ...l, index: (l.index - 1 + l.images.length) % l.images.length } : null); }}
                aria-label="Previous"
              >
                <ChevronLeft size={36} />
              </button>
              <button
                className="absolute right-4 text-background hover:text-gold"
                onClick={(e) => { e.stopPropagation(); setLightbox((l) => l ? { ...l, index: (l.index + 1) % l.images.length } : null); }}
                aria-label="Next"
              >
                <ChevronRight size={36} />
              </button>
            </>
          )}
          <img
            src={lightbox.images[lightbox.index].file_url}
            alt={lightbox.images[lightbox.index].file_name}
            className="max-h-[90vh] max-w-[90vw] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
