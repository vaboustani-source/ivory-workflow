import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { CONTRACTOR_ROLES, roleLabel, type ContractorRole } from "@/lib/contractors";
import { Plus, X, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface ServiceRequest {
  id: string;
  contractor_id: string;
  role: ContractorRole;
  status: string;
  agreed_hourly_rate: number | null;
  agreed_hours: number | null;
  agreed_total: number | null;
}
interface TeamMember {
  id: string;
  contractor_id: string;
  role: ContractorRole;
  agreed_hourly_rate: number | null;
  agreed_hours: number | null;
  agreed_total: number | null;
  contractor: { full_name: string; email: string } | null;
}

export function ServicesAndTeamCard({ clientId }: { clientId: string }) {
  const [services, setServices] = useState<ContractorRole[]>([]);
  const [requests, setRequests] = useState<Record<string, ServiceRequest[]>>({});
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: cl }, { data: reqs }, { data: tm }] = await Promise.all([
      supabase.from("clients").select("services_added").eq("id", clientId).maybeSingle(),
      supabase.from("contractor_service_requests").select("id, contractor_id, role, status, agreed_hourly_rate, agreed_hours, agreed_total").eq("client_id", clientId),
      supabase.from("wedding_team").select("id, contractor_id, role, agreed_hourly_rate, agreed_hours, agreed_total, contractor:contractors(full_name, email)").eq("client_id", clientId),
    ]);
    const s = (cl?.services_added as ContractorRole[] | null) ?? [];
    setServices(s);
    const grouped: Record<string, ServiceRequest[]> = {};
    ((reqs ?? []) as ServiceRequest[]).forEach((r) => {
      grouped[r.role] = grouped[r.role] ?? [];
      grouped[r.role].push(r);
    });
    setRequests(grouped);
    setTeam((tm ?? []) as any);
    setLoading(false);
  };

  useEffect(() => { load(); }, [clientId]);

  const addService = async (role: ContractorRole) => {
    if (services.includes(role)) return;
    const next = [...services, role];
    const { error } = await supabase.from("clients").update({ services_added: next }).eq("id", clientId);
    if (error) return toast.error(error.message);
    toast.success(`Added ${roleLabel(role)}`);
    setAdding(false);
    load();
  };

  const removeService = async (role: ContractorRole) => {
    if (team.some((t) => t.role === role)) return toast.error("Already booked — remove from team first");
    if (!confirm(`Remove ${roleLabel(role)} from this wedding's services?`)) return;
    const next = services.filter((r) => r !== role);
    const { error } = await supabase.from("clients").update({ services_added: next }).eq("id", clientId);
    if (error) return toast.error(error.message);
    load();
  };

  const removeTeamMember = async (m: TeamMember) => {
    if (!confirm(`Remove ${m.contractor?.full_name ?? "this contractor"} from the team?`)) return;
    const { error } = await supabase.from("wedding_team").delete().eq("id", m.id);
    if (error) return toast.error(error.message);
    load();
  };

  const teamByRole = team.reduce<Record<string, TeamMember[]>>((acc, m) => {
    acc[m.role] = acc[m.role] ?? []; acc[m.role].push(m); return acc;
  }, {});

  if (loading) return <p className="text-sm text-muted-foreground">Loading services…</p>;

  return (
    <div className="space-y-4">
      {services.length === 0 && team.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No additional services added yet.</p>
      ) : (
        <ul className="space-y-3">
          {services.map((role) => {
            const booked = teamByRole[role] ?? [];
            const reqs = requests[role] ?? [];
            const pending = reqs.filter((r) => r.status === "sent").length;
            const accepted = reqs.filter((r) => r.status === "accepted" && !booked.length).length;
            return (
              <li key={role} className="border border-border rounded-md p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{roleLabel(role)}</p>
                    {booked.length > 0 ? (
                      <ul className="mt-1.5 space-y-1">
                        {booked.map((b) => (
                          <li key={b.id} className="text-xs text-foreground flex items-center justify-between gap-2">
                            <span>
                              <span className="text-sage">✓ Booked:</span> {b.contractor?.full_name ?? "—"}
                              {b.agreed_hourly_rate && b.agreed_hours && (
                                <> @ ${b.agreed_hourly_rate}/hr × {b.agreed_hours}hr = <span className="text-primary font-medium">${b.agreed_total}</span></>
                              )}
                            </span>
                            <button onClick={() => removeTeamMember(b)} className="text-muted-foreground hover:text-magenta" title="Remove">
                              <Trash2 size={12} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-1">
                        {pending > 0 && <>{pending} request{pending === 1 ? "" : "s"} awaiting reply · </>}
                        {accepted > 0 && <>{accepted} accepted, contract pending · </>}
                        Not yet booked.
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Link
                      to="/studio/clients/$id_/sourcing"
                      params={{ id: clientId }}
                      search={{ role }}
                      className="text-xs border border-gold text-gold px-2.5 py-1 rounded-md hover:bg-gold/10 inline-flex items-center gap-1"
                    >
                      <Search size={11} /> {booked.length ? "Manage" : "Source"}
                    </Link>
                    {booked.length === 0 && (
                      <button onClick={() => removeService(role)} className="text-muted-foreground hover:text-magenta" title="Remove">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
          {/* booked roles not in services_added (legacy) */}
          {Object.keys(teamByRole).filter((r) => !services.includes(r as ContractorRole)).map((role) => (
            <li key={role} className="border border-border rounded-md p-3">
              <p className="text-sm font-medium text-foreground">{roleLabel(role)}</p>
              <ul className="mt-1.5 space-y-1">
                {teamByRole[role].map((b) => (
                  <li key={b.id} className="text-xs text-foreground">
                    <span className="text-sage">✓ Booked:</span> {b.contractor?.full_name ?? "—"}
                    {b.agreed_hourly_rate && b.agreed_hours && (
                      <> @ ${b.agreed_hourly_rate}/hr × {b.agreed_hours}hr = <span className="text-primary font-medium">${b.agreed_total}</span></>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="border border-dashed border-gold/50 rounded-md p-3 space-y-2">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Add a service</p>
          <div className="flex flex-wrap gap-1.5">
            {CONTRACTOR_ROLES.filter((r) => !services.includes(r.value)).map((r) => (
              <button key={r.value} onClick={() => addService(r.value)} className="text-xs border border-border text-foreground px-2.5 py-1 rounded-md hover:border-primary hover:text-primary">
                {r.label}
              </button>
            ))}
          </div>
          <button onClick={() => setAdding(false)} className="text-xs text-muted-foreground">Cancel</button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="text-xs text-magenta hover:underline inline-flex items-center gap-1">
          <Plus size={12} /> Add a service
        </button>
      )}
    </div>
  );
}
