import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { X } from "lucide-react";
import { CONTRACTOR_ROLES, type ContractorRole } from "@/lib/contractors";

export interface ContractorRow {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  roles: ContractorRole[];
  homebase_address: string | null;
  homebase_lat: number | null;
  homebase_lng: number | null;
  rate_notes: string | null;
  preferred_min_hourly_rate: number | null;
  preferred_max_hourly_rate: number | null;
  instagram: string | null;
  portfolio_url: string | null;
  bio: string | null;
  is_active: boolean;
  notes: string | null;
  jobs_count: number;
  last_worked_with_at: string | null;
}

interface Props {
  existing?: ContractorRow | null;
  onClose: () => void;
  onSaved: () => void;
}

export function ContractorEditorModal({ existing, onClose, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    full_name: existing?.full_name ?? "",
    email: existing?.email ?? "",
    phone: existing?.phone ?? "",
    roles: (existing?.roles ?? []) as ContractorRole[],
    homebase_address: existing?.homebase_address ?? "",
    rate_notes: existing?.rate_notes ?? "",
    preferred_min_hourly_rate: existing?.preferred_min_hourly_rate?.toString() ?? "",
    preferred_max_hourly_rate: existing?.preferred_max_hourly_rate?.toString() ?? "",
    instagram: existing?.instagram ?? "",
    portfolio_url: existing?.portfolio_url ?? "",
    bio: existing?.bio ?? "",
    notes: existing?.notes ?? "",
    is_active: existing?.is_active ?? true,
  });

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onEsc);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onEsc); document.body.style.overflow = ""; };
  }, [onClose]);

  const toggleRole = (r: ContractorRole) => {
    setForm((f) => ({
      ...f,
      roles: f.roles.includes(r) ? f.roles.filter((x) => x !== r) : [...f.roles, r],
    }));
  };

  const save = async () => {
    if (!form.full_name.trim()) return toast.error("Full name is required");
    if (!form.email.trim()) return toast.error("Email is required");
    setSaving(true);

    let lat: number | null = existing?.homebase_lat ?? null;
    let lng: number | null = existing?.homebase_lng ?? null;
    const addressChanged = (form.homebase_address || "").trim() !== (existing?.homebase_address ?? "");
    if (form.homebase_address.trim() && (addressChanged || lat == null || lng == null)) {
      try {
        const { data: geo, error } = await supabase.functions.invoke("geocode-address", {
          body: { address: form.homebase_address.trim() },
        });
        if (!error && geo && typeof geo.lat === "number" && typeof geo.lng === "number") {
          lat = geo.lat;
          lng = geo.lng;
        } else {
          toast.warning("Couldn't geocode the homebase address — saved without coordinates.");
          if (addressChanged) { lat = null; lng = null; }
        }
      } catch {
        toast.warning("Couldn't geocode the homebase address — saved without coordinates.");
        if (addressChanged) { lat = null; lng = null; }
      }
    }
    if (!form.homebase_address.trim()) { lat = null; lng = null; }

    const payload = {
      full_name: form.full_name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || null,
      roles: form.roles,
      homebase_address: form.homebase_address.trim() || null,
      homebase_lat: lat,
      homebase_lng: lng,
      rate_notes: form.rate_notes.trim() || null,
      preferred_min_hourly_rate: form.preferred_min_hourly_rate ? Number(form.preferred_min_hourly_rate) : null,
      preferred_max_hourly_rate: form.preferred_max_hourly_rate ? Number(form.preferred_max_hourly_rate) : null,
      instagram: form.instagram.trim() || null,
      portfolio_url: form.portfolio_url.trim() || null,
      bio: form.bio.trim() || null,
      notes: form.notes.trim() || null,
      is_active: form.is_active,
    };

    const result = existing
      ? await supabase.from("contractors").update(payload).eq("id", existing.id)
      : await supabase.from("contractors").insert(payload);
    setSaving(false);
    if (result.error) return toast.error(result.error.message);
    toast.success(existing ? "Contractor updated" : "Contractor added");
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-plum/70 flex items-stretch md:items-center justify-center p-0 md:p-6" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-surface w-full md:max-w-[720px] max-h-screen md:max-h-[90vh] flex flex-col md:rounded-lg shadow-elevated overflow-hidden">
        <div className="sticky top-0 bg-surface border-b border-gold/30 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="font-serif italic text-xl text-primary">
            {existing ? "Edit contractor" : "Add new contractor"}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-magenta" aria-label="Close"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Full name *">
              <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="input" />
            </Field>
            <Field label="Email *">
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input" />
            </Field>
            <Field label="Phone">
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="input" />
            </Field>
            <Field label="Active">
              <label className="inline-flex items-center gap-2 mt-2">
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="accent-primary" />
                <span className="text-sm text-foreground">Show in sourcing</span>
              </label>
            </Field>
          </div>

          <Field label="Roles">
            <div className="grid grid-cols-2 gap-2">
              {CONTRACTOR_ROLES.map((r) => (
                <label key={r.value} className="inline-flex items-center gap-2 text-sm text-foreground cursor-pointer">
                  <input type="checkbox" checked={form.roles.includes(r.value)} onChange={() => toggleRole(r.value)} className="accent-primary" />
                  {r.label}
                </label>
              ))}
            </div>
          </Field>

          <Field label="Homebase address (auto-geocoded on save)">
            <input value={form.homebase_address} onChange={(e) => setForm({ ...form, homebase_address: e.target.value })} placeholder="123 Main St, Brooklyn, NY 11201" className="input" />
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Min hourly rate ($)">
              <input type="number" min="0" value={form.preferred_min_hourly_rate} onChange={(e) => setForm({ ...form, preferred_min_hourly_rate: e.target.value })} className="input" />
            </Field>
            <Field label="Max hourly rate ($)">
              <input type="number" min="0" value={form.preferred_max_hourly_rate} onChange={(e) => setForm({ ...form, preferred_max_hourly_rate: e.target.value })} className="input" />
            </Field>
          </div>

          <Field label="Rate notes">
            <input value={form.rate_notes} onChange={(e) => setForm({ ...form, rate_notes: e.target.value })} placeholder="$75 6+hr; $90 4-6hr" className="input" />
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Instagram">
              <input value={form.instagram} onChange={(e) => setForm({ ...form, instagram: e.target.value })} placeholder="@handle" className="input" />
            </Field>
            <Field label="Portfolio URL">
              <input value={form.portfolio_url} onChange={(e) => setForm({ ...form, portfolio_url: e.target.value })} placeholder="https://…" className="input" />
            </Field>
          </div>

          <Field label="Bio">
            <textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} rows={3} className="input" />
          </Field>

          <Field label="Internal notes (studio-only)">
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} className="input" />
          </Field>
        </div>

        <div className="sticky bottom-0 bg-surface border-t border-gold/30 px-6 py-4 flex items-center justify-end gap-2">
          <button onClick={onClose} className="text-sm text-muted-foreground hover:text-magenta">Cancel</button>
          <button onClick={save} disabled={saving} className="bg-primary text-primary-foreground px-5 py-2 rounded-md text-sm hover:bg-primary/90 disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      <style>{`.input{width:100%;padding:.5rem .75rem;background:hsl(var(--surface));border:1px solid hsl(var(--border));border-radius:.375rem;font-size:.875rem;color:hsl(var(--foreground));}.input:focus{outline:none;box-shadow:0 0 0 2px hsl(var(--primary)/0.2);}`}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground block mb-2">{label}</label>
      {children}
    </div>
  );
}
