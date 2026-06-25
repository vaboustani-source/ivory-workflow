import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { Mail, Inbox as InboxIcon, RefreshCw, Send, X, Loader2, Sparkles, Check, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { getGmailAccount, type GmailAccountInfo } from "@/lib/gmail/oauth.functions";
import {
  listGmailThreads,
  getGmailThread,
  sendGmail,
  type ThreadListResult,
  type ThreadDetail,
  type ParsedMessage,
} from "@/lib/gmail/messages.functions";
import {
  listActionQueue,
  refreshActionQueue,
  updateActionItem,
  type ActionItem,
} from "@/lib/gmail/action-queue.functions";

export const Route = createFileRoute("/studio/mail")({
  component: MailPage,
});

function relTime(internalDate: string): string {
  const ms = Number(internalDate);
  if (!ms) return "";
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function MailPage() {
  const fetchAccount = useServerFn(getGmailAccount);
  const { data: account, isLoading: acctLoading } = useQuery({
    queryKey: ["gmail-account"],
    queryFn: async (): Promise<GmailAccountInfo> => (await fetchAccount()) as GmailAccountInfo,
  });

  if (acctLoading) {
    return (
      <div className="p-10 text-muted-foreground flex items-center gap-2">
        <Loader2 size={16} className="animate-spin" /> Loading mailbox…
      </div>
    );
  }
  if (!account?.connected) {
    return <DisconnectedState />;
  }
  return <MailContainer accountEmail={account.email} />;
}

function MailContainer({ accountEmail }: { accountEmail: string | null }) {
  const [tab, setTab] = useState<"inbox" | "queue">("queue");
  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] -mx-6 -my-6">
      <div className="flex items-center gap-1 px-4 border-b border-border bg-surface">
        <TabBtn active={tab === "queue"} onClick={() => setTab("queue")}>
          <Sparkles size={14} /> Action Queue
        </TabBtn>
        <TabBtn active={tab === "inbox"} onClick={() => setTab("inbox")}>
          <InboxIcon size={14} /> Inbox
        </TabBtn>
        <div className="ml-auto text-[11px] text-muted-foreground pr-3 truncate max-w-[260px]">
          {accountEmail ?? "—"}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === "inbox" ? <InboxView accountEmail={accountEmail} /> : <ActionQueueView />}
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-2.5 text-sm border-b-2 transition-colors ${
        active
          ? "border-primary text-primary font-medium"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function DisconnectedState() {
  return (
    <div className="max-w-xl mx-auto mt-24 text-center px-6">
      <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary mb-4">
        <Mail size={26} />
      </div>
      <h1 className="font-serif italic text-[28px] text-primary">Connect your Gmail</h1>
      <p className="text-sm text-muted-foreground mt-2">
        See and reply to your studio inbox right inside Stories by Victoria. Each user connects
        their own Gmail account; only you can see your mailbox.
      </p>
      <div className="mt-6">
        <Link to="/studio/settings/integrations">
          <Button>Go to Integrations</Button>
        </Link>
      </div>
    </div>
  );
}

function InboxView({ accountEmail }: { accountEmail: string | null }) {
  const qc = useQueryClient();
  const fetchThreads = useServerFn(listGmailThreads);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);

  const threadsQ = useQuery({
    queryKey: ["gmail-threads"],
    queryFn: async (): Promise<ThreadListResult> =>
      (await fetchThreads({ data: {} })) as ThreadListResult,
  });

  return (
    <div className="flex h-full">
      {/* Param accountEmail is rendered by parent header; keep here as no-op so signature stays. */}
      <span className="hidden">{accountEmail}</span>
      {/* Sidebar */}
      <aside className="w-[360px] border-r border-border flex flex-col bg-surface">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="min-w-0">
            <div className="font-serif italic text-primary text-lg">Inbox</div>
            <div className="text-[11px] text-muted-foreground truncate">{accountEmail ?? "—"}</div>
          </div>
          <div className="flex items-center gap-1">
            <button
              className="p-1.5 text-muted-foreground hover:text-foreground"
              title="Refresh"
              onClick={() => qc.invalidateQueries({ queryKey: ["gmail-threads"] })}
            >
              <RefreshCw size={14} />
            </button>
            <button
              className="p-1.5 text-muted-foreground hover:text-foreground"
              title="Compose"
              onClick={() => { setSelectedThreadId(null); setComposeOpen(true); }}
            >
              <Send size={14} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {threadsQ.isLoading && (
            <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          )}
          {threadsQ.isError && (
            <div className="p-6 text-sm text-magenta">
              {(threadsQ.error as Error)?.message ?? "Failed to load"}
            </div>
          )}
          {threadsQ.data && threadsQ.data.threads.length === 0 && (
            <div className="p-6 text-sm text-muted-foreground italic">Inbox empty</div>
          )}
          {threadsQ.data?.threads.map((t) => {
            const active = t.threadId === selectedThreadId;
            return (
              <button
                key={t.threadId}
                onClick={() => { setSelectedThreadId(t.threadId); setComposeOpen(false); }}
                className={`w-full text-left px-4 py-3 border-b border-border/60 hover:bg-background-alt/50 ${
                  active ? "bg-background-alt" : ""
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div className={`truncate text-sm ${t.unread ? "font-semibold text-foreground" : "text-foreground"}`}>
                    {t.fromName || t.from || "(unknown)"}
                  </div>
                  <div className="text-[10px] text-muted-foreground shrink-0">{relTime(t.internalDate)}</div>
                </div>
                <div className={`truncate text-sm ${t.unread ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                  {t.subject || "(no subject)"}
                </div>
                <div className="truncate text-xs text-muted-foreground mt-0.5">{t.snippet}</div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Reading pane */}
      <main className="flex-1 min-w-0 overflow-y-auto bg-background">
        {composeOpen ? (
          <ComposePane
            mode="new"
            onClose={() => setComposeOpen(false)}
            onSent={() => {
              setComposeOpen(false);
              qc.invalidateQueries({ queryKey: ["gmail-threads"] });
            }}
          />
        ) : selectedThreadId ? (
          <ThreadPane threadId={selectedThreadId} />
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <InboxIcon size={28} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">Select a conversation</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function ThreadPane({ threadId }: { threadId: string }) {
  const qc = useQueryClient();
  const fetchThread = useServerFn(getGmailThread);
  const [replyOpen, setReplyOpen] = useState(false);

  const q = useQuery({
    queryKey: ["gmail-thread", threadId],
    queryFn: async (): Promise<ThreadDetail> =>
      (await fetchThread({ data: { threadId } })) as ThreadDetail,
  });

  if (q.isLoading) {
    return (
      <div className="p-10 text-muted-foreground flex items-center gap-2">
        <Loader2 size={16} className="animate-spin" /> Loading thread…
      </div>
    );
  }
  if (q.isError || !q.data) {
    return <div className="p-10 text-magenta">{(q.error as Error)?.message ?? "Failed to load"}</div>;
  }

  const messages = q.data.messages;
  const subject = messages[0]?.subject ?? "(no subject)";
  const last = messages[messages.length - 1];

  return (
    <div className="max-w-3xl mx-auto p-8">
      <h1 className="font-serif italic text-[26px] text-primary mb-6">{subject}</h1>
      <div className="space-y-4">
        {messages.map((m) => (
          <MessageCard key={m.id} m={m} />
        ))}
      </div>
      {!replyOpen && last && (
        <div className="mt-6">
          <Button onClick={() => setReplyOpen(true)}>Reply</Button>
        </div>
      )}
      {replyOpen && last && (
        <ComposePane
          mode="reply"
          replyTo={last}
          threadId={threadId}
          onClose={() => setReplyOpen(false)}
          onSent={() => {
            setReplyOpen(false);
            qc.invalidateQueries({ queryKey: ["gmail-thread", threadId] });
            qc.invalidateQueries({ queryKey: ["gmail-threads"] });
          }}
        />
      )}
    </div>
  );
}

function MessageCard({ m }: { m: ParsedMessage }) {
  const [showHtml, setShowHtml] = useState(true);
  const hasHtml = m.html.length > 0;
  return (
    <div className="border border-border rounded-md bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3 mb-3 border-b border-border/60 pb-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground truncate">{m.from}</div>
          <div className="text-xs text-muted-foreground truncate">
            to {m.to.join(", ")}{m.cc.length > 0 ? ` · cc ${m.cc.join(", ")}` : ""}
          </div>
        </div>
        <div className="text-xs text-muted-foreground shrink-0">{m.date}</div>
      </div>
      {hasHtml && showHtml ? (
        <div
          className="text-sm leading-relaxed [&_a]:text-primary [&_a]:underline"
          dangerouslySetInnerHTML={{ __html: m.html }}
        />
      ) : (
        <pre className="text-sm leading-relaxed whitespace-pre-wrap font-sans">{m.text || m.html.replace(/<[^>]+>/g, "")}</pre>
      )}
      {hasHtml && (
        <div className="mt-2">
          <button
            className="text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => setShowHtml((s) => !s)}
          >
            {showHtml ? "View plain text" : "View HTML"}
          </button>
        </div>
      )}
      {m.attachments.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border/60 text-xs text-muted-foreground">
          {m.attachments.length} attachment{m.attachments.length === 1 ? "" : "s"}: {m.attachments.map((a) => a.filename).join(", ")}
        </div>
      )}
    </div>
  );
}

type ComposeProps =
  | { mode: "new"; onClose: () => void; onSent: () => void }
  | {
      mode: "reply";
      replyTo: ParsedMessage;
      threadId: string;
      onClose: () => void;
      onSent: () => void;
    };

function ComposePane(props: ComposeProps) {
  const isReply = props.mode === "reply";
  const initialTo = useMemo(() => {
    if (!isReply) return "";
    // Reply to the From address.
    const from = props.replyTo.from;
    const m = from.match(/<([^>]+)>/);
    return m ? m[1] : from;
  }, [isReply, props]);
  const initialSubject = useMemo(() => {
    if (!isReply) return "";
    const s = props.replyTo.subject || "";
    return /^re:/i.test(s) ? s : `Re: ${s}`;
  }, [isReply, props]);

  const [to, setTo] = useState(initialTo);
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState("");

  const send = useServerFn(sendGmail);
  const mutation = useMutation({
    mutationFn: async () => {
      const toList = to.split(",").map((s) => s.trim()).filter(Boolean);
      const ccList = cc.split(",").map((s) => s.trim()).filter(Boolean);
      if (toList.length === 0) throw new Error("To is required");
      if (!subject.trim()) throw new Error("Subject is required");
      if (!body.trim()) throw new Error("Body is required");
      const payload: Parameters<typeof send>[0] extends infer X ? X : never = {
        data: {
          to: toList,
          cc: ccList.length > 0 ? ccList : undefined,
          subject,
          text: body,
          ...(isReply
            ? {
                threadId: props.threadId,
                inReplyToMessageId: props.replyTo.rfc822MessageId ?? undefined,
                references:
                  [props.replyTo.references, props.replyTo.rfc822MessageId]
                    .filter(Boolean).join(" ") || undefined,
              }
            : {}),
        },
      } as never;
      return send(payload);
    },
    onSuccess: () => {
      toast.success("Email sent");
      props.onSent();
    },
    onError: (e: Error) => toast.error("Send failed", { description: e.message }),
  });

  return (
    <div className={isReply ? "mt-6 border border-border rounded-md bg-surface p-5" : "max-w-3xl mx-auto p-8"}>
      {!isReply && (
        <div className="flex items-center justify-between mb-4">
          <h1 className="font-serif italic text-[24px] text-primary">New message</h1>
          <button onClick={props.onClose} className="text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>
      )}
      <div className="space-y-3">
        <Field label="To">
          <input
            value={to} onChange={(e) => setTo(e.target.value)}
            placeholder="recipient@example.com"
            className="w-full bg-background border border-border rounded-sm px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Cc">
          <input
            value={cc} onChange={(e) => setCc(e.target.value)}
            placeholder="optional"
            className="w-full bg-background border border-border rounded-sm px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Subject">
          <input
            value={subject} onChange={(e) => setSubject(e.target.value)}
            className="w-full bg-background border border-border rounded-sm px-3 py-2 text-sm"
          />
        </Field>
        <textarea
          value={body} onChange={(e) => setBody(e.target.value)}
          rows={isReply ? 6 : 14}
          placeholder="Write your message…"
          className="w-full bg-background border border-border rounded-sm px-3 py-2 text-sm font-sans"
        />
      </div>
      <div className="flex justify-end gap-2 mt-4">
        {isReply && (
          <Button variant="outline" onClick={props.onClose} disabled={mutation.isPending}>Cancel</Button>
        )}
        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? "Sending…" : "Send"}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      {children}
    </label>
  );
}

// =================== Action Queue ===================

const CATEGORY_LABEL: Record<string, string> = {
  new_inquiry: "New inquiry",
  active_client: "Active client",
  vendor: "Vendor",
  booking_scheduling: "Scheduling",
  admin_logistics: "Admin",
  personal: "Personal",
  promo_newsletter: "Newsletter",
  other: "Other",
};
const CATEGORY_TONE: Record<string, string> = {
  new_inquiry: "bg-gold/15 text-gold-foreground border-gold/40",
  active_client: "bg-primary/10 text-primary border-primary/30",
  vendor: "bg-blue-100 text-blue-900 border-blue-300",
  booking_scheduling: "bg-purple-100 text-purple-900 border-purple-300",
  admin_logistics: "bg-amber-100 text-amber-900 border-amber-300",
  personal: "bg-pink-100 text-pink-900 border-pink-300",
  promo_newsletter: "bg-muted text-muted-foreground border-border",
  other: "bg-muted text-muted-foreground border-border",
};

function ActionQueueView() {
  const qc = useQueryClient();
  const list = useServerFn(listActionQueue);
  const refresh = useServerFn(refreshActionQueue);

  const q = useQuery({
    queryKey: ["gmail-action-queue"],
    queryFn: async () => (await list({ data: {} })) as { items: ActionItem[] },
  });

  const refreshMut = useMutation({
    mutationFn: async () => (await refresh({ data: { limit: 15 } })) as {
      scanned: number; generated: number;
    },
    onSuccess: (r) => {
      toast.success(`Scanned ${r.scanned} threads`, {
        description: r.generated > 0 ? `Generated ${r.generated} new drafts` : "All up to date",
      });
      qc.invalidateQueries({ queryKey: ["gmail-action-queue"] });
    },
    onError: (e: Error) => toast.error("Refresh failed", { description: e.message }),
  });

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-4xl mx-auto p-8">
        <div className="flex items-end justify-between mb-6">
          <div>
            <h1 className="font-serif italic text-[26px] text-primary leading-tight">Action Queue</h1>
            <p className="text-sm text-muted-foreground mt-1">
              AI-categorized incoming threads with on-brand draft replies. Review, edit, and send.
            </p>
          </div>
          <Button
            onClick={() => refreshMut.mutate()}
            disabled={refreshMut.isPending}
            className="gap-2"
          >
            {refreshMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {refreshMut.isPending ? "Generating…" : "Generate drafts"}
          </Button>
        </div>

        {q.isLoading && (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        )}
        {q.isError && (
          <div className="text-sm text-magenta">{(q.error as Error)?.message ?? "Failed to load"}</div>
        )}
        {q.data && q.data.items.length === 0 && (
          <div className="bg-surface border border-border rounded-md p-10 text-center">
            <Sparkles size={22} className="mx-auto mb-2 text-primary opacity-60" />
            <p className="font-serif italic text-lg text-primary">Queue is empty</p>
            <p className="text-sm text-muted-foreground mt-1">
              Click "Generate drafts" to scan your most recent inbox threads.
            </p>
          </div>
        )}
        <div className="space-y-3">
          {q.data?.items.map((item) => (
            <ActionItemCard key={item.id} item={item} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ActionItemCard({ item }: { item: ActionItem }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(item.ai_draft);
  const updateFn = useServerFn(updateActionItem);
  const sendFn = useServerFn(sendGmail);
  const getThreadFn = useServerFn(getGmailThread);

  const saveMut = useMutation({
    mutationFn: async (patch: { ai_draft?: string; status?: ActionItem["status"] }) =>
      updateFn({ data: { id: item.id, ...patch } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gmail-action-queue"] }),
  });

  const sendMut = useMutation({
    mutationFn: async () => {
      // Need last message metadata to build a proper reply.
      const td = (await getThreadFn({ data: { threadId: item.thread_id } })) as ThreadDetail;
      const last = td.messages[td.messages.length - 1];
      if (!last) throw new Error("Thread empty");
      const m = last.from.match(/<([^>]+)>/);
      const to = m ? [m[1]] : [last.from];
      const subj = /^re:/i.test(last.subject) ? last.subject : `Re: ${last.subject || "(no subject)"}`;
      await sendFn({
        data: {
          threadId: item.thread_id,
          to,
          subject: subj,
          text: draft,
          inReplyToMessageId: last.rfc822MessageId ?? undefined,
          references:
            [last.references, last.rfc822MessageId].filter(Boolean).join(" ") || undefined,
        },
      } as Parameters<typeof sendFn>[0]);
      await updateFn({ data: { id: item.id, status: "sent", ai_draft: draft } });
    },
    onSuccess: () => {
      toast.success("Sent");
      qc.invalidateQueries({ queryKey: ["gmail-action-queue"] });
    },
    onError: (e: Error) => toast.error("Send failed", { description: e.message }),
  });

  const tone = CATEGORY_TONE[item.category] ?? CATEGORY_TONE.other;
  const label = CATEGORY_LABEL[item.category] ?? item.category;
  const when = item.last_message_at
    ? new Date(item.last_message_at).toLocaleDateString([], { month: "short", day: "numeric" })
    : "";

  return (
    <div className="border border-border rounded-md bg-surface overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-4 py-3 hover:bg-background-alt/40 transition-colors"
      >
        <div className="flex items-start gap-3">
          <span className={`shrink-0 inline-flex items-center text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm border ${tone}`}>
            {label}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium text-foreground truncate">
                {item.fromName || item.from || "(unknown)"}
              </span>
              <span className="text-[11px] text-muted-foreground shrink-0">{when}</span>
            </div>
            <div className="text-sm text-foreground truncate">{item.subject || "(no subject)"}</div>
            {item.ai_summary && (
              <div className="text-xs text-muted-foreground italic mt-0.5 truncate">
                {item.ai_summary}
              </div>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground shrink-0 mt-1">
            {item.status === "sent" ? (
              <span className="inline-flex items-center gap-1 text-primary"><Check size={11} /> sent</span>
            ) : item.status === "dismissed" ? "dismissed" : item.status === "snoozed" ? (
              <span className="inline-flex items-center gap-1"><Clock size={11} /> snoozed</span>
            ) : item.status}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border px-4 py-4 bg-background-alt/30">
          {item.ai_draft || item.status === "needs_review" ? (
            <>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                Suggested reply
              </div>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={Math.min(14, Math.max(6, draft.split("\n").length + 2))}
                placeholder="No draft generated. Write a reply…"
                className="w-full bg-surface border border-border rounded-sm px-3 py-2 text-sm font-sans"
              />
              <div className="flex flex-wrap gap-2 mt-3 justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => saveMut.mutate({ status: "snoozed" })}
                  disabled={saveMut.isPending}
                >
                  Snooze
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => saveMut.mutate({ status: "dismissed" })}
                  disabled={saveMut.isPending}
                >
                  Dismiss
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => saveMut.mutate({ ai_draft: draft })}
                  disabled={saveMut.isPending || draft === item.ai_draft}
                >
                  Save edits
                </Button>
                <Button
                  size="sm"
                  onClick={() => sendMut.mutate()}
                  disabled={sendMut.isPending || !draft.trim()}
                  className="gap-1"
                >
                  {sendMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  {draft === item.ai_draft ? "Approve & Send" : "Send"}
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground italic">No draft. Use the inbox tab to reply manually.</p>
          )}
        </div>
      )}
    </div>
  );
}
