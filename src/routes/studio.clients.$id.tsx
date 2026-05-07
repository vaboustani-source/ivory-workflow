import { createFileRoute, Link, useParams, useSearch, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ChevronRight } from "lucide-react";
import { shortDate, relativeTime, daysBetween } from "@/lib/dates";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { ClientTimelineTab } from "@/components/ClientTimelineTab";
import { TimelineDisplay } from "@/components/TimelineDisplay";
import { PortraitSequenceViewer } from "@/components/PortraitSequenceViewer";
import { ClientMessagesTab } from "@/components/messages/ClientMessagesTab";
import { StudioDocumentsTab } from "@/components/studio/DocumentsTab";
import { StudioFormsTab } from "@/components/studio/FormsTab";
import { ActivityList } from "@/components/ActivityList";
import { ServicesAndTeamCard } from "@/components/studio/ServicesAndTeamCard";

type SearchSchema = { tab?: string; contract_id?: string; questionnaire_id?: string };

export const Route = createFileRoute("/studio/clients/$id")({
  validateSearch: (s: Record<string, unknown>): SearchSchema => ({
    tab: typeof s.tab === "string" ? s.tab : undefined,
    contract_id: typeof s.contract_id === "string" ? s.contract_id : undefined,
    questionnaire_id: typeof s.questionnaire_id === "string" ? s.questionnaire_id : undefined,
  }),
  component: ClientDetail,
});

const TABS = ["Overview", "Timeline", "Photography", "Family Portraits", "Messages", "Documents", "Forms", "Activity", "Gallery", "Notes"] as const;
type Tab = typeof TABS[number];

const TAB_KEY: Record<Tab, string> = {
  Overview: "overview", Timeline: "timeline", Photography: "photography", "Family Portraits": "portrait-sequence", Messages: "messages",
  Documents: "documents", Forms: "forms", Activity: "activity", Gallery: "gallery", Notes: "notes",
};
const KEY_TO_TAB: Record<string, Tab> = Object.fromEntries(
  Object.entries(TAB_KEY).map(([k, v]) => [v, k as Tab])
) as Record<string, Tab>;

interface ClientDetailRow {
  id: string;
  couple_name_1: string;
  couple_name_2: string | null;
  primary_email: string;
  secondary_email: string | null;
  phone: string | null;
  wedding_date: string | null;
  venue_name: string | null;
  venue_address: string | null;
  venue_street: string | null;
  venue_city: string | null;
  venue_state: string | null;
  venue_postal_code: string | null;
  guest_count: number | null;
  package_price: number | null;
  coverage_hours: number | null;
  status: string;
  last_contacted_at: string | null;
  portal_invited_at: string | null;
  portal_first_login_at: string | null;
  primary_client_last_name: string | null;
  alternate_client_last_name: string | null;
  primary_client_phone: string | null;
  alternate_client_phone: string | null;
  shared_street_address: string | null;
  shared_city: string | null;
  shared_state: string | null;
  shared_zipcode: string | null;
  package: { name: string } | null;
  photographer: { full_name: string | null } | null;
  manager: { full_name: string | null } | null;
}

const STATUS_DOT: Record<string, string> = {
  lead: "bg-accent",
  booked: "bg-sage",
  active: "bg-magenta",
  delivered: "bg-gold",
  complete: "bg-plum",
  archived: "bg-muted-foreground",
};

function ClientDetail() {
  const { id } = useParams({ from: "/studio/clients/$id" });
  const search = useSearch({ from: "/studio/clients/$id" });
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [client, setClient] = useState<ClientDetailRow | null>(null);
  const initialTab: Tab = (search.tab && KEY_TO_TAB[search.tab]) || "Overview";
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => {
    const t = (search.tab && KEY_TO_TAB[search.tab]) || "Overview";
    setTab(t);
  }, [search.tab]);

  const changeTab = (t: Tab) => {
    setTab(t);
    navigate({
      to: "/studio/clients/$id",
      params: { id },
      search: { tab: TAB_KEY[t] },
      replace: true,
    });
  };
  const [taskCounts, setTaskCounts] = useState({ open: 0, complete: 0 });
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [{ data }, openCount, doneCount] = await Promise.all([
      supabase.from("clients").select(`
        id, couple_name_1, couple_name_2, primary_email, secondary_email, phone,
        wedding_date, venue_name, venue_address, venue_street, venue_city, venue_state, venue_postal_code, guest_count, package_price, coverage_hours, status,
        primary_client_last_name, alternate_client_last_name, primary_client_phone, alternate_client_phone,
        shared_street_address, shared_city, shared_state, shared_zipcode,
        last_contacted_at, portal_invited_at, portal_first_login_at,
        package:packages(name),
        photographer:profiles!clients_photographer_id_fkey(full_name),
        manager:profiles!clients_manager_id_fkey(full_name)
      `).eq("id", id).maybeSingle(),
      supabase.from("tasks").select("id", { count: "exact", head: true }).eq("client_id", id).eq("status", "pending"),
      supabase.from("tasks").select("id", { count: "exact", head: true }).eq("client_id", id).eq("status", "complete"),
    ]);
    setClient(data as unknown as ClientDetailRow);
    setTaskCounts({ open: openCount.count ?? 0, complete: doneCount.count ?? 0 });
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  const sendInvite = async () => {
    const isResend = !!client?.portal_invited_at;
    try {
      const { data, error } = await supabase.functions.invoke("send-portal-invite", {
        body: { client_id: id, invitation_type: isResend ? "resend" : "initial" },
      });
      if (error) throw error;
      if (data?.warn === "no_resend_key") {
        toast.success("Invite created. Email key not configured — share link manually.");
      } else if (data?.warn === "email_failed") {
        toast.success("Invite created, but email send failed.");
      } else {
        toast.success("Portal invite sent.");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't send invite.");
    }
    load();
  };

  if (loading || !client) {
    return <p className="font-serif italic text-lg text-primary">Loading…</p>;
  }

  const days = daysBetween(client.wedding_date);
  const portalState: "not_invited" | "invited" | "active" =
    client.portal_first_login_at ? "active" : client.portal_invited_at ? "invited" : "not_invited";

  return (
    <div className="-mx-8 -my-8">
      {/* Breadcrumb */}
      <div className="px-8 py-6 bg-background">
        <nav className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Link to="/studio/clients" className="hover:text-primary">Clients</Link>
          <ChevronRight size={12} />
          <span className="text-foreground">{client.couple_name_1}{client.couple_name_2 ? " & " + client.couple_name_2 : ""}</span>
        </nav>
      </div>

      {/* Hero */}
      <div className="bg-primary px-8 min-h-[120px] max-h-[120px] flex items-center justify-between">
        <div>
          <h1 className="font-serif italic text-[32px] text-background">
            {client.couple_name_1}{client.couple_name_2 ? " & " + client.couple_name_2 : ""}
          </h1>
          <p className="text-sm text-gold mt-1">
            {client.wedding_date ? shortDate(client.wedding_date) : "Date TBD"}
            {client.venue_name && <> · {client.venue_name}</>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="bg-surface text-foreground px-3 py-1.5 rounded-sm text-xs uppercase tracking-wider flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${STATUS_DOT[client.status]}`} />
            {client.status}
          </span>
          <button className="border border-gold text-gold px-4 py-1.5 rounded-md text-sm hover:bg-gold/10">Edit</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-8 border-b border-primary/20 bg-background">
        <div className="flex gap-1 -mb-px">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => changeTab(t)}
              className={`px-4 py-3 text-sm transition-colors border-b-[3px] ${
                tab === t ? "text-primary border-primary" : "text-muted-foreground border-transparent hover:text-primary"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="px-8 py-8 bg-background">
        {tab === "Overview" ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left column */}
            <div className="space-y-6">
              <Card title="Couple">
                <div className="space-y-4">
                  <PersonBlock name={client.couple_name_1} email={client.primary_email} phone={client.phone} />
                  {client.couple_name_2 && (
                    <PersonBlock name={client.couple_name_2} email={client.secondary_email} phone={null} />
                  )}
                </div>
              </Card>
              <Card title="Wedding details">
                <Row label="Date" value={client.wedding_date ? shortDate(client.wedding_date) : "—"} />
                <Row label="Venue" value={client.venue_name ?? "—"} />
                <AddressRow client={client} />
                <Row label="Guest count" value={client.guest_count?.toString() ?? "—"} />
                <Row label="Package" value={client.package?.name ?? "—"} />
                <Row label="Investment" value={client.package_price ? `$${Number(client.package_price).toLocaleString()}` : "—"} />
                <CoverageHoursRow clientId={client.id} initial={client.coverage_hours} onSaved={(v: number | null) => setClient((c) => c ? { ...c, coverage_hours: v } : c)} />
              </Card>
              <Card title="Client contact info">
                <SectionHeader>Primary client</SectionHeader>
                <TextFieldRow label="Last name" value={client.primary_client_last_name} field="primary_client_last_name" clientId={client.id}
                  onSaved={(v) => setClient((c) => c ? { ...c, primary_client_last_name: v } : c)} />
                <TextFieldRow label="Phone" value={client.primary_client_phone} field="primary_client_phone" clientId={client.id}
                  onSaved={(v) => setClient((c) => c ? { ...c, primary_client_phone: v } : c)} />
                <SectionHeader>Alternate client</SectionHeader>
                <TextFieldRow label="Last name" value={client.alternate_client_last_name} field="alternate_client_last_name" clientId={client.id}
                  onSaved={(v) => setClient((c) => c ? { ...c, alternate_client_last_name: v } : c)} />
                <TextFieldRow label="Phone" value={client.alternate_client_phone} field="alternate_client_phone" clientId={client.id}
                  onSaved={(v) => setClient((c) => c ? { ...c, alternate_client_phone: v } : c)} />
                <SectionHeader>Shared home address</SectionHeader>
                <TextFieldRow label="Street address" value={client.shared_street_address} field="shared_street_address" clientId={client.id}
                  onSaved={(v) => setClient((c) => c ? { ...c, shared_street_address: v } : c)} />
                <TextFieldRow label="City" value={client.shared_city} field="shared_city" clientId={client.id}
                  onSaved={(v) => setClient((c) => c ? { ...c, shared_city: v } : c)} />
                <div className="grid grid-cols-2 gap-3">
                  <TextFieldRow label="State" value={client.shared_state} field="shared_state" clientId={client.id} maxLength={2}
                    onSaved={(v) => setClient((c) => c ? { ...c, shared_state: v } : c)} />
                  <TextFieldRow label="ZIP" value={client.shared_zipcode} field="shared_zipcode" clientId={client.id}
                    onSaved={(v) => setClient((c) => c ? { ...c, shared_zipcode: v } : c)} />
                </div>
              </Card>
            </div>

            {/* Right column */}
            <div className="space-y-6">
              <Card title="Studio team">
                <div className="space-y-4">
                  <TeamRow label="Photographer" name={client.photographer?.full_name ?? "Unassigned"} />
                  <TeamRow label="Manager" name={client.manager?.full_name ?? "Unassigned"} />
                </div>
              </Card>
              <Card title="Portal access">
                <p className="text-sm text-foreground mb-4">
                  {portalState === "not_invited" && "Not yet invited"}
                  {portalState === "invited" && `Invited ${relativeTime(client.portal_invited_at)}`}
                  {portalState === "active" && `Active since ${shortDate(client.portal_first_login_at)}`}
                </p>
                {portalState === "not_invited" && (
                  <button onClick={sendInvite} className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium hover:bg-primary/90">
                    Send portal invite
                  </button>
                )}
                {portalState === "invited" && (
                  <button onClick={sendInvite} className="border border-gold text-gold px-4 py-2 rounded-md text-sm hover:bg-gold/10">
                    Resend invite
                  </button>
                )}
              </Card>
              <Card title="Quick stats">
                <Row
                  label="Last contacted"
                  value={relativeTime(client.last_contacted_at)}
                  valueClass={client.last_contacted_at && Date.now() - new Date(client.last_contacted_at).getTime() > 14 * 86400000 ? "text-magenta" : ""}
                />
                <div className="flex justify-between items-center py-2 border-b border-border last:border-0">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">Days until wedding</span>
                  <span className="font-serif text-[28px] text-primary leading-none">{days !== null && days >= 0 ? days : "—"}</span>
                </div>
                <Row label="Tasks open / completed" value={`${taskCounts.open} / ${taskCounts.complete}`} />
                <Row label="Messages exchanged" value="0" />
              </Card>
              <Card title="Services & team">
                <ServicesAndTeamCard clientId={client.id} />
              </Card>
            </div>
          </div>
        ) : tab === "Timeline" ? (
          <ClientTimelineTab clientId={id} />
        ) : tab === "Photography" ? (
          <TimelineDisplay clientId={id} editable={true} />
        ) : tab === "Family Portraits" ? (
          <div className="space-y-5">
            <h2 className="font-serif italic text-[28px] text-primary">Family Portraits</h2>
            <PortraitSequenceViewer clientId={id} editable={true} />
          </div>
        ) : tab === "Messages" ? (
          <ClientMessagesTab clientId={id} />
        ) : tab === "Documents" ? (
          <StudioDocumentsTab clientId={id} openContractId={search.contract_id} />
        ) : tab === "Forms" ? (
          <StudioFormsTab clientId={id} openQuestionnaireId={search.questionnaire_id} />
        ) : tab === "Activity" ? (
          <div className="space-y-5">
            <h2 className="font-serif italic text-[28px] text-primary">Activity</h2>
            <div className="bg-surface rounded-lg shadow-soft p-6 border-t-2 border-gold">
              <ActivityList clientId={id} mode="studio" />
            </div>
          </div>
        ) : (
          <div className="bg-surface rounded-lg shadow-soft py-20 text-center">
            <p className="font-serif italic text-2xl text-primary">Coming soon. Building this in the next phase.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-lg shadow-soft p-6 border-t-2 border-gold">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-4">{title}</p>
      {children}
    </div>
  );
}

function Row({ label, value, valueClass = "" }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-border last:border-0">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`text-sm text-foreground ${valueClass}`}>{value}</span>
    </div>
  );
}

function AddressRow({ client }: { client: ClientDetailRow }) {
  const parts = [client.venue_street, client.venue_city, client.venue_state, client.venue_postal_code].filter(Boolean) as string[];
  if (parts.length === 0) {
    // Fall back to legacy single-field address if present.
    if (client.venue_address) {
      const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(client.venue_address)}`;
      return (
        <div className="flex justify-between items-center py-2 border-b border-border last:border-0">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Address</span>
          <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm text-foreground underline decoration-muted-foreground/40 hover:decoration-primary">
            {client.venue_address}
          </a>
        </div>
      );
    }
    return (
      <div className="flex justify-between items-center py-2 border-b border-border last:border-0">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">Address</span>
        <span className="text-sm text-foreground">—</span>
      </div>
    );
  }
  const fullAddress = [
    client.venue_name,
    client.venue_street,
    [client.venue_city, client.venue_state].filter(Boolean).join(", "),
    client.venue_postal_code,
  ].filter(Boolean).join(", ");
  const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`;
  return (
    <div className="flex justify-between items-start gap-4 py-2 border-b border-border last:border-0">
      <span className="text-xs uppercase tracking-wider text-muted-foreground pt-0.5">Address</span>
      <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm text-foreground text-right underline decoration-muted-foreground/40 hover:decoration-primary">
        {client.venue_street && <>{client.venue_street}<br /></>}
        {(client.venue_city || client.venue_state) && (
          <>{[client.venue_city, client.venue_state].filter(Boolean).join(", ")}{client.venue_postal_code ? ` ${client.venue_postal_code}` : ""}</>
        )}
      </a>
    </div>
  );
}

function CoverageHoursRow({ clientId, initial, onSaved }: { clientId: string; initial: number | null; onSaved: (v: number | null) => void }) {
  const [val, setVal] = useState<string>(initial != null ? String(initial) : "");
  const [saving, setSaving] = useState(false);
  useEffect(() => { setVal(initial != null ? String(initial) : ""); }, [initial]);

  const save = async () => {
    const trimmed = val.trim();
    const parsed = trimmed === "" ? null : Number(trimmed);
    if (parsed !== null && (Number.isNaN(parsed) || parsed < 0)) return;
    setSaving(true);
    const { error } = await supabase.from("clients").update({ coverage_hours: parsed }).eq("id", clientId);
    setSaving(false);
    if (error) { toast.error("Couldn't save coverage hours."); return; }
    onSaved(parsed);
  };

  return (
    <div className="flex justify-between items-start gap-4 py-2 border-b border-border last:border-0">
      <div className="flex-1">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Booked coverage hours</p>
        <p className="text-[11px] text-muted-foreground/80 mt-0.5 italic">
          Total photography coverage time the couple has paid for, including any add-ons. Used to flag upsell opportunities.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          step="0.5"
          min="0"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={save}
          placeholder="—"
          className="w-20 px-2 py-1 bg-background border border-border rounded-md text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <span className="text-xs text-muted-foreground">hr</span>
        {saving && <span className="text-[10px] text-muted-foreground">…</span>}
      </div>
    </div>
  );
}

function PersonBlock({ name, email, phone }: { name: string; email: string | null; phone: string | null }) {
  return (
    <div>
      <p className="font-serif italic text-lg text-primary">{name}</p>
      {email && <p className="text-sm text-foreground mt-1">{email}</p>}
      {phone && <p className="text-sm text-muted-foreground">{phone}</p>}
    </div>
  );
}

function TeamRow({ label, name }: { label: string; name: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-8 w-8 rounded-full bg-plum text-background flex items-center justify-center text-xs">
        {name[0]?.toUpperCase() ?? "?"}
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="text-sm text-foreground">{name}</p>
      </div>
    </div>
  );
}
