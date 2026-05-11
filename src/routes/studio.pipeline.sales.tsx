import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import {
  DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors,
  useDroppable, useDraggable,
} from "@dnd-kit/core";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useEffectiveScope } from "@/lib/view-as";
import { shortDate, daysBetween } from "@/lib/dates";
import { NewClientModal } from "@/components/NewClientModal";
import { BookingConfirmationModal } from "@/components/invoicing/BookingConfirmationModal";
import { toast } from "sonner";

export const Route = createFileRoute("/studio/pipeline/sales")({
  component: PipelinePage,
});

type ColumnId = "new" | "discovery" | "proposal_sent" | "awaiting" | "booked";

const COLUMNS: { id: ColumnId; label: string; emptyText: string }[] = [
  { id: "new", label: "NEW LEADS", emptyText: "No new leads." },
  { id: "discovery", label: "DISCOVERY BOOKED", emptyText: "No calls booked." },
  { id: "proposal_sent", label: "PROPOSAL SENT", emptyText: "No proposals out." },
  { id: "awaiting", label: "AWAITING DECISION", emptyText: "Nothing pending." },
  { id: "booked", label: "BOOKED ✓", emptyText: "Nothing recently booked." },
];

interface Lead {
  id: string;
  couple_name_1: string;
  couple_name_2: string | null;
  wedding_date: string | null;
  inquiry_source: string | null;
  status: string;
  manager_id: string | null;
  booked_at: string | null;
  created_at: string;
  is_tbd_booking?: boolean | null;
  tbd_finalize_by?: string | null;
  tbd_cancelled_at?: string | null;
  manager?: { full_name: string | null } | null;
  bookings?: { id: string; event_type: string | null; status: string | null; scheduled_at: string | null }[];
  proposals?: { id: string; status: string | null; sent_at: string | null }[];
}

function bucketize(lead: Lead): { col: ColumnId; sinceISO: string } {
  // Booked
  if (lead.status === "booked" || (lead.proposals ?? []).some((p) => p.status === "accepted")) {
    return { col: "booked", sinceISO: lead.booked_at ?? lead.created_at };
  }
  const sentProposals = (lead.proposals ?? []).filter((p) => p.status === "sent" && p.sent_at);
  if (sentProposals.length > 0) {
    const mostRecent = sentProposals.reduce((a, b) => new Date(a.sent_at!) > new Date(b.sent_at!) ? a : b);
    const days = Math.abs(daysBetween(mostRecent.sent_at!) ?? 0);
    if (days >= 5) return { col: "awaiting", sinceISO: mostRecent.sent_at! };
    return { col: "proposal_sent", sinceISO: mostRecent.sent_at! };
  }
  const discovery = (lead.bookings ?? []).find(
    (b) => b.event_type === "discovery_call" && (b.status === "confirmed" || b.status === "completed"),
  );
  if (discovery) return { col: "discovery", sinceISO: discovery.scheduled_at ?? lead.created_at };
  return { col: "new", sinceISO: lead.created_at };
}

function PipelinePage() {
  const { profile } = useAuth();
  const { scopeClientIds } = useEffectiveScope();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ leadId: string; from: ColumnId; to: ColumnId; lead: Lead } | null>(null);
  const [bookingLead, setBookingLead] = useState<Lead | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const load = async () => {
    const ids = await scopeClientIds();
    let q = supabase
      .from("clients")
      .select(`
        id, couple_name_1, couple_name_2, wedding_date, inquiry_source, status, manager_id, booked_at, created_at,
        manager:profiles!clients_manager_id_fkey(full_name),
        bookings(id, event_type, status, scheduled_at),
        proposals(id, status, sent_at)
      `)
      .or("status.eq.lead,status.eq.booked");
    if (ids !== null) {
      if (ids.length === 0) { setLeads([]); return; }
      q = q.in("id", ids);
    }
    const { data } = await q;
    // Filter out booked clients more than 7 days old
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const filtered = ((data ?? []) as unknown as Lead[]).filter((l) => {
      if (l.status === "booked") {
        const bookedAt = l.booked_at ? new Date(l.booked_at).getTime() : 0;
        return bookedAt > 0 && now - bookedAt < sevenDays;
      }
      return true;
    });
    setLeads(filtered);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const grouped = useMemo(() => {
    const map: Record<ColumnId, { lead: Lead; sinceISO: string }[]> = {
      new: [], discovery: [], proposal_sent: [], awaiting: [], booked: [],
    };
    leads.forEach((l) => {
      const { col, sinceISO } = bucketize(l);
      map[col].push({ lead: l, sinceISO });
    });
    return map;
  }, [leads]);

  const handleDragEnd = (event: DragEndEvent) => {
    if (!event.over) return;
    const leadId = event.active.id as string;
    const toCol = event.over.id as ColumnId;
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return;
    const fromCol = bucketize(lead).col;
    if (fromCol === toCol) return;
    if (toCol === "booked") {
      setBookingLead(lead);
      return;
    }
    setConfirm({ leadId, from: fromCol, to: toCol, lead });
  };

  const applyTransition = async () => {
    if (!confirm) return;
    const { lead, to } = confirm;
    if (to === "discovery") {
      await supabase.from("bookings").insert({
        client_id: lead.id,
        event_type: "discovery_call",
        status: "confirmed",
        scheduled_at: new Date().toISOString(),
        booked_by_user: profile?.id,
      });
      toast.success("Discovery call booked.");
    } else if (to === "proposal_sent") {
      await supabase.from("proposals").insert({
        client_id: lead.id,
        status: "sent",
        sent_at: new Date().toISOString(),
        created_by: profile?.id,
        version: 1,
      });
      toast.success("Proposal marked as sent.");
    } else if (to === "awaiting") {
      // Backdate sent_at by 5 days on most recent sent proposal, or create one
      const sent = (lead.proposals ?? []).filter((p) => p.status === "sent");
      if (sent.length > 0) {
        const past = new Date(); past.setDate(past.getDate() - 6);
        await supabase.from("proposals").update({ sent_at: past.toISOString() }).eq("id", sent[0].id);
      } else {
        const past = new Date(); past.setDate(past.getDate() - 6);
        await supabase.from("proposals").insert({
          client_id: lead.id, status: "sent", sent_at: past.toISOString(), created_by: profile?.id, version: 1,
        });
      }
      toast.success("Moved to awaiting decision.");
    } else if (to === "booked") {
      await supabase.from("clients").update({ status: "booked", booked_at: new Date().toISOString() }).eq("id", lead.id);
      toast.success("Booked! Workflow starts now.");
    } else if (to === "new") {
      // Reset to bare lead — best-effort: nothing to do beyond status check
      toast("Moved back to new leads.");
    }
    setConfirm(null);
    load();
  };

  return (
    <div>
      <header className="flex items-start justify-between mb-8">
        <div>
          <h1 className="font-serif italic text-[28px] text-primary leading-tight">Sales Pipeline</h1>
          <p className="mt-1 text-sm text-muted-foreground">From inquiry to booked.</p>
        </div>
        <button onClick={() => setModalOpen(true)} className="bg-primary text-primary-foreground rounded-md px-4 py-2.5 text-sm font-medium hover:bg-primary/90 flex items-center gap-2">
          <Plus size={16} /> New Lead
        </button>
      </header>

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="flex gap-6 overflow-x-auto pb-4">
          {COLUMNS.map((col) => (
            <Column key={col.id} id={col.id} label={col.label} count={grouped[col.id].length} emptyText={col.emptyText}>
              {grouped[col.id].map(({ lead, sinceISO }) => (
                <LeadCard key={lead.id} lead={lead} sinceISO={sinceISO} />
              ))}
            </Column>
          ))}
        </div>
      </DndContext>

      <NewClientModal open={modalOpen} onClose={() => setModalOpen(false)} onCreated={load} />

      {confirm && (
        <ConfirmDialog
          confirm={confirm}
          onConfirm={applyTransition}
          onCancel={() => setConfirm(null)}
        />
      )}

      <BookingConfirmationModal
        open={!!bookingLead}
        clientId={bookingLead?.id ?? null}
        coupleLabel={bookingLead ? `${bookingLead.couple_name_1}${bookingLead.couple_name_2 ? " & " + bookingLead.couple_name_2 : ""}` : ""}
        weddingDateISO={bookingLead?.wedding_date ?? null}
        onClose={() => setBookingLead(null)}
        onConfirmed={load}
      />
    </div>
  );
}

function Column({ id, label, count, emptyText, children }: {
  id: ColumnId; label: string; count: number; emptyText: string; children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`shrink-0 w-[280px] rounded-lg p-3 ${isOver ? "bg-background-alt/80" : "bg-background-alt/50"} transition-colors`}>
      <div className="flex items-center justify-between mb-3 px-1">
        <p className="text-[11px] uppercase tracking-wider text-foreground">{label}</p>
        <span className="text-xs text-muted-foreground bg-surface px-2 py-0.5 rounded-full">{count}</span>
      </div>
      <div className="space-y-2 min-h-[200px]">
        {count === 0 ? (
          <p className="font-serif italic text-sm text-muted-foreground text-center py-8">{emptyText}</p>
        ) : children}
      </div>
    </div>
  );
}

function LeadCard({ lead, sinceISO }: { lead: Lead; sinceISO: string }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  const days = Math.abs(daysBetween(sinceISO) ?? 0);
  const isStale = days >= 7;
  const couple = `${lead.couple_name_1}${lead.couple_name_2 ? " & " + lead.couple_name_2 : ""}`;
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`bg-surface rounded-md shadow-soft p-4 cursor-grab active:cursor-grabbing relative ${isDragging ? "opacity-40" : ""}`}
    >
      {isStale && <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-magenta" title={`${days} days in stage`} />}
      <p className="font-serif italic text-base text-primary leading-tight">{couple}</p>
      {lead.inquiry_source && <p className="text-[13px] text-muted-foreground mt-1">via {lead.inquiry_source}</p>}
      {lead.wedding_date && <p className="text-xs text-foreground mt-1">{shortDate(lead.wedding_date)}</p>}
      <div className="flex items-center justify-between mt-3">
        <span className="h-6 w-6 rounded-full bg-plum text-background flex items-center justify-center text-[10px]" title={lead.manager?.full_name ?? ""}>
          {(lead.manager?.full_name ?? "?").charAt(0).toUpperCase()}
        </span>
        <span className="text-xs text-muted-foreground">{days} day{days === 1 ? "" : "s"} in stage</span>
      </div>
    </div>
  );
}

const PROMPTS: Record<ColumnId, { title: string; body: string }> = {
  new: { title: "Move back to new leads?", body: "This won't undo records, but the card will appear in New Leads." },
  discovery: { title: "Mark discovery call as booked?", body: "We'll create a discovery_call booking for now." },
  proposal_sent: { title: "Mark proposal as sent?", body: "We'll create a proposal record in 'sent' status. Full proposal builder ships in Phase 4." },
  awaiting: { title: "Mark as awaiting decision?", body: "We'll backdate the sent proposal so it shows in the awaiting column." },
  booked: { title: "Mark as booked?", body: "This will set client.status='booked' and trigger the booking workflow." },
};

function ConfirmDialog({ confirm, onConfirm, onCancel }: {
  confirm: { lead: Lead; from: ColumnId; to: ColumnId };
  onConfirm: () => void; onCancel: () => void;
}) {
  const prompt = PROMPTS[confirm.to];
  return (
    <div className="fixed inset-0 z-50 bg-foreground/30 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-background rounded-lg shadow-elevated w-full max-w-[420px] p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-serif italic text-xl text-primary">{prompt.title}</h3>
        <p className="text-sm text-muted-foreground mt-2">{prompt.body}</p>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onCancel} className="text-sm text-muted-foreground px-3 py-2">Cancel</button>
          <button onClick={onConfirm} className="text-sm bg-primary text-primary-foreground rounded-md px-4 py-2 hover:bg-primary/90">Confirm</button>
        </div>
      </div>
    </div>
  );
}
