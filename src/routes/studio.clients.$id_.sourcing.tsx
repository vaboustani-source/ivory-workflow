import { createFileRoute, useParams, useSearch, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CONTRACTOR_ROLES, roleLabel, milesBetween, type ContractorRole, type ServiceRequestStatus } from "@/lib/contractors";
import { shortDate, relativeTime } from "@/lib/dates";
import { toast } from "sonner";
import { ChevronRight, MapPin, Send, Check, X, FileText } from "lucide-react";

type Search = { role?: string };

export const Route = createFileRoute("/studio/clients/$id_/sourcing")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    role: typeof s.role === "string" ? s.role : undefined,
  }),
  component: SourcingScreen,
});

interface Contractor {
  id: string;
  full_name: string;
  email: string;
  roles: ContractorRole[];
  homebase_address: string | null;
  homebase_lat: number | null;
  homebase_lng: number | null;
  preferred_min_hourly_rate: number | null;
  preferred_max_hourly_rate: number | null;
  is_active: boolean;
  jobs_count: number;
  last_worked_with_at: string | null;
}

interface ServiceRequest {
  id: string;
  contractor_id: string;
  role: ContractorRole;
  status: ServiceRequestStatus;
  sent_at: string | null;
  responded_at: string | null;
  agreed_hourly_rate: number | null;
  agreed_hours: number | null;
  agreed_total: number | null;
  contract_id: string | null;
  travel_distance_miles: number | null;
}

interface Client {
  id: string;
  couple_name_1: string;
  couple_name_2: string | null;
  wedding_date: string | null;
  venue_name: string | null;
  venue_address: string | null;
  venue_street: string | null;
  venue_city: string | null;
  venue_state: string | null;
  venue_postal_code: string | null;
}

function SourcingScreen() {
  const { id } = useParams({ from: "/studio/clients/$id_/sourcing" });
  const { role } = useSearch({ from: "/studio/clients/$id_/sourcing" });
  const navigate = useNavigate();

  const [client, setClient] = useState<Client | null>(null);
  const [venueLatLng, setVenueLatLng] = useState<{ lat: number; lng: number } | null>(null);
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRole, setActiveRole] = useState<ContractorRole>((role as ContractorRole) ?? "second_shooter");
  const [composeFor, setComposeFor] = useState<Contractor | null>(null);
  const [logRespFor, setLogRespFor] = useState<ServiceRequest | null>(null);
  const [sendContractFor, setSendContractFor] = useState<ServiceRequest | null>(null);

  const venueAddress = useMemo(() => {
    if (!client) return "";
    const parts = [client.venue_street, client.venue_city, client.venue_state, client.venue_postal_code].filter(Boolean);
    return parts.length ? parts.join(", ") : (client.venue_address ?? "");
  }, [client]);

  const load = async () => {
    setLoading(true);
    const [{ data: cl }, { data: ctr }, { data: reqs }] = await Promise.all([
      supabase.from("clients").select("id, couple_name_1, couple_name_2, wedding_date, venue_name, venue_address, venue_street, venue_city, venue_state, venue_postal_code").eq("id", id).maybeSingle(),
      supabase.from("contractors").select("id, full_name, email, roles, homebase_address, homebase_lat, homebase_lng, preferred_min_hourly_rate, preferred_max_hourly_rate, is_active, jobs_count, last_worked_with_at").eq("is_active", true),
      supabase.from("contractor_service_requests").select("id, contractor_id, role, status, sent_at, responded_at, agreed_hourly_rate, agreed_hours, agreed_total, contract_id, travel_distance_miles").eq("client_id", id),
    ]);
    setClient(cl as any);
    setContractors((ctr ?? []) as any);
    setRequests((reqs ?? []) as any);
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  // Geocode venue once
  useEffect(() => {
    if (!venueAddress) { setVenueLatLng(null); return; }
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("geocode-address", { body: { address: venueAddress } });
        if (!error && data && typeof data.lat === "number") setVenueLatLng({ lat: data.lat, lng: data.lng });
      } catch { /* noop */ }
    })();
  }, [venueAddress]);

  const matchedContractors = useMemo(() => {
    const list = contractors
      .filter((c) => c.roles?.includes(activeRole))
      .map((c) => {
        const distance = (venueLatLng && c.homebase_lat != null && c.homebase_lng != null)
          ? milesBetween(venueLatLng.lat, venueLatLng.lng, c.homebase_lat, c.homebase_lng)
          : null;
        const req = requests.find((r) => r.contractor_id === c.id && r.role === activeRole);
        return { contractor: c, distance, request: req };
      });
    list.sort((a, b) => {
      if (a.distance == null && b.distance == null) return a.contractor.full_name.localeCompare(b.contractor.full_name);
      if (a.distance == null) return 1;
      if (b.distance == null) return -1;
      return a.distance - b.distance;
    });
    return list;
  }, [contractors, requests, activeRole, venueLatLng]);

  const coupleName = client ? `${client.couple_name_1}${client.couple_name_2 ? " & " + client.couple_name_2 : ""}` : "";

  return (
    <div className="space-y-6">
      <nav className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Link to="/studio/clients" className="hover:text-primary">Clients</Link>
        <ChevronRight size={12} />
        <Link to="/studio/clients/$id" params={{ id }} className="hover:text-primary">{coupleName || "Client"}</Link>
        <ChevronRight size={12} />
        <span className="text-foreground">Sourcing</span>
      </nav>

      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="font-serif italic text-[28px] text-primary leading-tight">Find a {roleLabel(activeRole)}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            For {coupleName} · {client?.wedding_date ? shortDate(client.wedding_date) : "TBD"}{client?.venue_name ? ` · ${client.venue_name}` : ""}
          </p>
        </div>
        <select
          value={activeRole}
          onChange={(e) => { setActiveRole(e.target.value as ContractorRole); navigate({ to: "/studio/clients/$id/sourcing", params: { id }, search: { role: e.target.value }, replace: true }); }}
          className="px-3 py-2 bg-surface border border-border rounded-md text-sm"
        >
          {CONTRACTOR_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </header>

      {!venueLatLng && venueAddress && (
        <div className="bg-gold/10 border border-gold/40 rounded-md p-3 text-xs text-foreground">
          Couldn't geocode the venue address — distances unavailable. Contractors are listed alphabetically.
        </div>
      )}

      {loading ? (
        <p className="font-serif italic text-primary p-8">Loading…</p>
      ) : matchedContractors.length === 0 ? (
        <div className="bg-surface rounded-lg shadow-soft py-16 text-center border-t-2 border-gold">
          <p className="font-serif italic text-2xl text-primary">No active contractors with this role.</p>
          <Link to="/studio/settings/contractors" className="text-sm text-magenta hover:underline mt-3 inline-block">Add one to the directory →</Link>
        </div>
      ) : (
        <div className="space-y-2">
          {matchedContractors.map(({ contractor: c, distance, request }) => (
            <div key={c.id} className="bg-surface rounded-lg shadow-soft border-t-2 border-gold p-4 flex flex-col md:flex-row md:items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-3 flex-wrap">
                  <h3 className="font-serif italic text-lg text-primary">{c.full_name}</h3>
                  {distance != null && (
                    <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                      <MapPin size={11} /> {distance.toFixed(0)} mi
                    </span>
                  )}
                  {(c.preferred_min_hourly_rate || c.preferred_max_hourly_rate) && (
                    <span className="text-xs text-muted-foreground">
                      ${c.preferred_min_hourly_rate ?? "?"}–{c.preferred_max_hourly_rate ?? "?"}/hr
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {c.jobs_count} prior job{c.jobs_count === 1 ? "" : "s"}
                  {c.last_worked_with_at && <> · last {relativeTime(c.last_worked_with_at)}</>}
                  {c.homebase_address && <> · base {c.homebase_address}</>}
                </p>
                {request && <RequestStatusLine req={request} />}
              </div>
              <div className="flex gap-2 shrink-0">
                {!request && (
                  <button onClick={() => setComposeFor(c)} className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 inline-flex items-center gap-1.5">
                    <Send size={12} /> Request availability
                  </button>
                )}
                {request?.status === "sent" && (
                  <button onClick={() => setLogRespFor(request)} className="text-xs border border-gold text-gold px-3 py-1.5 rounded-md hover:bg-gold/10">
                    Log response
                  </button>
                )}
                {request?.status === "accepted" && !request.contract_id && (
                  <button onClick={() => setSendContractFor(request)} className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 inline-flex items-center gap-1.5">
                    <FileText size={12} /> Send contract
                  </button>
                )}
                {request?.status === "booked" && (
                  <span className="text-xs bg-sage/20 text-foreground px-3 py-1.5 rounded-md inline-flex items-center gap-1.5">
                    <Check size={12} /> Booked
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {composeFor && client && (
        <ComposeRequestModal
          client={client}
          contractor={composeFor}
          role={activeRole}
          venueAddress={venueAddress}
          distanceMiles={(() => {
            const c = composeFor;
            return (venueLatLng && c.homebase_lat != null && c.homebase_lng != null)
              ? milesBetween(venueLatLng.lat, venueLatLng.lng, c.homebase_lat, c.homebase_lng) : null;
          })()}
          onClose={() => setComposeFor(null)}
          onSent={() => { setComposeFor(null); load(); }}
        />
      )}
      {logRespFor && (
        <LogResponseModal request={logRespFor} onClose={() => setLogRespFor(null)} onSaved={() => { setLogRespFor(null); load(); }} />
      )}
      {sendContractFor && client && (
        <SendContractModal request={sendContractFor} client={client} onClose={() => setSendContractFor(null)} onSent={() => { setSendContractFor(null); load(); }} />
      )}
    </div>
  );
}

function RequestStatusLine({ req }: { req: ServiceRequest }) {
  const map: Record<ServiceRequestStatus, { label: string; cls: string }> = {
    sent: { label: "Awaiting response", cls: "text-gold" },
    accepted: { label: "Accepted", cls: "text-sage" },
    declined: { label: "Declined", cls: "text-magenta" },
    no_response: { label: "No response", cls: "text-muted-foreground" },
    cancelled: { label: "Cancelled", cls: "text-muted-foreground" },
    booked: { label: "Booked", cls: "text-sage" },
  };
  const m = map[req.status];
  return (
    <p className={`text-xs mt-1.5 ${m.cls}`}>
      {m.label}
      {req.sent_at && <> · sent {relativeTime(req.sent_at)}</>}
      {req.agreed_hourly_rate && req.agreed_hours && (
        <> · ${req.agreed_hourly_rate}/hr × {req.agreed_hours}h = ${req.agreed_total}</>
      )}
    </p>
  );
}

function ComposeRequestModal({ client, contractor, role, venueAddress, distanceMiles, onClose, onSent }: {
  client: Client; contractor: Contractor; role: ContractorRole; venueAddress: string;
  distanceMiles: number | null; onClose: () => void; onSent: () => void;
}) {
  const couple = `${client.couple_name_1}${client.couple_name_2 ? " & " + client.couple_name_2 : ""}`;
  const [subject, setSubject] = useState(`Wedding availability — ${client.wedding_date ? shortDate(client.wedding_date) : "TBD"}`);
  const [body, setBody] = useState(
    `Hi ${contractor.full_name.split(" ")[0]},\n\n` +
    `We're looking for a ${roleLabel(role)} for the ${couple} wedding on ${client.wedding_date ? shortDate(client.wedding_date) : "TBD"}` +
    `${client.venue_name ? ` at ${client.venue_name}` : ""}${venueAddress ? ` (${venueAddress})` : ""}.\n\n` +
    `Are you available? If so, what's your hourly rate for this date?\n\n` +
    `Thanks!`
  );
  const [sending, setSending] = useState(false);

  const send = async () => {
    setSending(true);
    const { data, error } = await supabase.functions.invoke("send-contractor-request", {
      body: {
        contractor_id: contractor.id,
        client_id: client.id,
        role,
        subject,
        body,
        agreed_distance_miles: distanceMiles,
      },
    });
    setSending(false);
    if (error || data?.error) { toast.error(error?.message ?? data?.error ?? "Failed to send"); return; }
    if (data?.warn) toast.success("Request logged — email may not have sent.");
    else toast.success("Availability request sent");
    onSent();
  };

  return (
    <Modal title={`Request availability — ${contractor.full_name}`} onClose={onClose}>
      <div className="space-y-4">
        <Field label="To"><span className="text-sm text-foreground">{contractor.email}</span></Field>
        <Field label="Subject">
          <input value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm" />
        </Field>
        <Field label="Message">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm font-mono" />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="text-sm text-muted-foreground px-4 py-2">Cancel</button>
          <button onClick={send} disabled={sending} className="text-sm bg-primary text-primary-foreground px-5 py-2 rounded-md hover:bg-primary/90 disabled:opacity-60">
            {sending ? "Sending…" : "Send request"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function LogResponseModal({ request, onClose, onSaved }: { request: ServiceRequest; onClose: () => void; onSaved: () => void }) {
  const [outcome, setOutcome] = useState<"accepted" | "declined" | "no_response">("accepted");
  const [rate, setRate] = useState("");
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const total = (Number(rate) || 0) * (Number(hours) || 0);

  const save = async () => {
    setSaving(true);
    const update: any = {
      status: outcome,
      responded_at: new Date().toISOString(),
      response_message: note || null,
    };
    if (outcome === "accepted") {
      const r = Number(rate); const h = Number(hours);
      if (!r || !h) { setSaving(false); toast.error("Rate and hours required for accepted"); return; }
      update.agreed_hourly_rate = r;
      update.agreed_hours = h;
      // agreed_total is a generated column — Postgres calculates it
    }
    const { error } = await supabase.from("contractor_service_requests").update(update).eq("id", request.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Response logged");
    onSaved();
  };

  return (
    <Modal title="Log contractor response" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Outcome">
          <div className="flex gap-2">
            {(["accepted", "declined", "no_response"] as const).map((o) => (
              <button key={o} onClick={() => setOutcome(o)} className={`text-xs px-3 py-1.5 rounded-md border ${outcome === o ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground"}`}>
                {o === "accepted" ? <><Check size={12} className="inline mr-1" />Accepted</> : o === "declined" ? <><X size={12} className="inline mr-1" />Declined</> : "No response"}
              </button>
            ))}
          </div>
        </Field>
        {outcome === "accepted" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Hourly rate ($)">
                <input type="number" value={rate} onChange={(e) => setRate(e.target.value)} className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm" />
              </Field>
              <Field label="Hours">
                <input type="number" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm" />
              </Field>
            </div>
            <p className="text-sm text-muted-foreground">Total: <span className="text-primary font-medium">${total.toLocaleString()}</span></p>
          </>
        )}
        <Field label="Notes (optional)">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm" />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="text-sm text-muted-foreground px-4 py-2">Cancel</button>
          <button onClick={save} disabled={saving} className="text-sm bg-primary text-primary-foreground px-5 py-2 rounded-md hover:bg-primary/90 disabled:opacity-60">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function SendContractModal({ request, client, onClose, onSent }: { request: ServiceRequest; client: Client; onClose: () => void; onSent: () => void }) {
  const [templates, setTemplates] = useState<{ id: string; name: string; content: string }[]>([]);
  const [templateId, setTemplateId] = useState<string>("blank");
  const [title, setTitle] = useState(`Contractor agreement — ${client.couple_name_1}`);
  const [content, setContent] = useState("");
  const [contractor, setContractor] = useState<{ full_name: string; email: string } | null>(null);
  const [timeline, setTimeline] = useState<{ ceremony_start_time: string | null; coverage_end_time: string | null } | null>(null);
  const [studioRow, setStudioRow] = useState<any>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: tpls }, { data: c }, { data: tl }, { data: studio }] = await Promise.all([
        supabase
          .from("contract_templates")
          .select("id, name, content, template_type")
          .eq("is_archived", false)
          .order("name"),
        supabase.from("contractors").select("full_name, email").eq("id", request.contractor_id).maybeSingle(),
        supabase.from("photography_timelines").select("ceremony_start_time, coverage_end_time").eq("client_id", client.id).maybeSingle(),
        supabase.from("studio_settings").select("photographer_name, photographer_company, studio_email, studio_phone, studio_address, studio_mailing_address, ein, instagram, website, overage_hourly_rate, video_cancellation_fee, album_credit_expiry_months, rescheduling_fee_pct").eq("is_active", true).maybeSingle(),
      ]);
      const filtered = ((tpls ?? []) as any[]).filter((t) => !t.template_type || t.template_type === "contractor");
      setTemplates(filtered);
      setContractor(c as any);
      setTimeline(tl as any);
      setStudioRow(studio as any);
    })();
  }, [request.contractor_id, client.id]);

  const applyTpl = (id: string) => {
    setTemplateId(id);
    if (id === "blank") return;
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setContent(t.content);
  };

  const send = async () => {
    if (!title.trim() || !content.trim()) return toast.error("Title and content required");
    setSending(true);
    const { resolvePlaceholdersWithMarkers } = await import("@/lib/contractTemplating");
    const resolved = resolvePlaceholdersWithMarkers(content, {
      client,
      contractor: contractor ?? undefined,
      serviceRequest: request,
      timeline: timeline ?? undefined,
      studio: {
        name: studioRow?.photographer_company ?? "Stories by Victoria",
        photographer_name: studioRow?.photographer_name ?? "",
        photographer_company: studioRow?.photographer_company ?? "Stories by Victoria",
        studio_email: studioRow?.studio_email ?? "",
        studio_phone: studioRow?.studio_phone ?? "",
        studio_address: studioRow?.studio_address ?? "",
        studio_mailing_address: studioRow?.studio_mailing_address ?? "",
        ein: studioRow?.ein ?? "",
        instagram: studioRow?.instagram ?? "",
        website: studioRow?.website ?? "",
        overage_hourly_rate: studioRow?.overage_hourly_rate ?? undefined,
        video_cancellation_fee: studioRow?.video_cancellation_fee ?? undefined,
        album_credit_expiry_months: studioRow?.album_credit_expiry_months ?? undefined,
        rescheduling_fee_pct: studioRow?.rescheduling_fee_pct ?? undefined,
      },
    });
    const { data, error } = await supabase.functions.invoke("send-contractor-contract", {
      body: { service_request_id: request.id, template_id: templateId === "blank" ? null : templateId, title: title.trim(), content: resolved },
    });
    setSending(false);
    if (error || data?.error) return toast.error(error?.message ?? data?.error ?? "Failed");
    toast.success("Contract sent to contractor");
    onSent();
  };

  return (
    <Modal title="Send contractor contract" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Template">
          <select value={templateId} onChange={(e) => applyTpl(e.target.value)} className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm">
            <option value="blank">Blank</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm" />
        </Field>
        <Field label="Contract body (HTML)">
          <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={14} className="w-full px-3 py-2 bg-surface border border-border rounded-md text-xs font-mono" />
        </Field>
        <p className="text-xs text-muted-foreground">Placeholders like <code className="text-gold">{"{contractor_first_name}"}</code> are resolved automatically before sending. A single-use signing link will be emailed to the contractor.</p>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="text-sm text-muted-foreground px-4 py-2">Cancel</button>
          <button onClick={send} disabled={sending} className="text-sm bg-primary text-primary-foreground px-5 py-2 rounded-md hover:bg-primary/90 disabled:opacity-60">
            {sending ? "Sending…" : "Send contract"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onEsc);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onEsc); document.body.style.overflow = ""; };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-plum/70 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-surface w-full max-w-2xl max-h-[90vh] flex flex-col rounded-lg shadow-elevated overflow-hidden">
        <div className="border-b border-gold/30 px-6 py-4 flex items-center justify-between">
          <h2 className="font-serif italic text-xl text-primary">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-magenta"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-6">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground block mb-1.5">{label}</label>
      {children}
    </div>
  );
}
