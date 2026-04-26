import { useState, useEffect, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { X } from "lucide-react";

interface Profile { id: string; full_name: string | null; }
interface Pkg { id: string; name: string; }

export function NewClientModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { profile } = useAuth();
  const [team, setTeam] = useState<Profile[]>([]);
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    couple_name_1: "",
    couple_name_2: "",
    primary_email: "",
    phone: "",
    wedding_date: "",
    venue_name: "",
    venue_address: "",
    status: "lead" as "lead" | "booked" | "active" | "delivered" | "complete" | "archived",
    package_id: "",
    photographer_id: "",
    manager_id: "",
  });

  useEffect(() => {
    if (!open) return;
    supabase.from("profiles").select("id, full_name").in("role", ["owner", "studio_manager", "associate_photographer"]).then(({ data }) => setTeam(data ?? []));
    supabase.from("packages").select("id, name").eq("is_active", true).order("display_order").then(({ data }) => setPackages(data ?? []));
  }, [open]);

  if (!open) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const payload = {
      couple_name_1: form.couple_name_1,
      couple_name_2: form.couple_name_2 || null,
      primary_email: form.primary_email,
      phone: form.phone || null,
      wedding_date: form.wedding_date || null,
      venue_name: form.venue_name || null,
      venue_address: form.venue_address || null,
      status: form.status,
      package_id: form.package_id || null,
      photographer_id: form.photographer_id || null,
      manager_id: form.manager_id || null,
    };
    const { data, error } = await supabase.from("clients").insert(payload).select("id").single();
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await supabase.from("activity_log").insert({
      user_id: profile?.id,
      action_type: "client.created",
      target_type: "client",
      target_id: data.id,
      description: `Added ${form.couple_name_1}${form.couple_name_2 ? " & " + form.couple_name_2 : ""}`,
    });
    toast.success("Client added.");
    onCreated();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-foreground/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background rounded-lg shadow-elevated w-full max-w-[480px] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-6">
          <h2 className="font-serif italic text-2xl text-primary">Add a new client</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-primary"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Couple name 1" required value={form.couple_name_1} onChange={(v) => setForm({ ...form, couple_name_1: v })} />
          <Field label="Couple name 2" value={form.couple_name_2} onChange={(v) => setForm({ ...form, couple_name_2: v })} />
          <Field label="Primary email" type="email" required value={form.primary_email} onChange={(v) => setForm({ ...form, primary_email: v })} />
          <Field label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
          <Field label="Wedding date" type="date" value={form.wedding_date} onChange={(v) => setForm({ ...form, wedding_date: v })} />
          <Field label="Venue name" value={form.venue_name} onChange={(v) => setForm({ ...form, venue_name: v })} />
          <Field label="Venue address" value={form.venue_address} onChange={(v) => setForm({ ...form, venue_address: v })} />
          <Select label="Status" value={form.status} onChange={(v) => setForm({ ...form, status: v as typeof form.status })}>
            {["lead", "booked", "active", "delivered", "complete", "archived"].map((s) => (<option key={s} value={s}>{s}</option>))}
          </Select>
          <Select label="Package" value={form.package_id} onChange={(v) => setForm({ ...form, package_id: v })}>
            <option value="">— None —</option>
            {packages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Select label="Photographer" value={form.photographer_id} onChange={(v) => setForm({ ...form, photographer_id: v })}>
            <option value="">— Unassigned —</option>
            {team.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
          </Select>
          <Select label="Manager" value={form.manager_id} onChange={(v) => setForm({ ...form, manager_id: v })}>
            <option value="">— Unassigned —</option>
            {team.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
          </Select>
          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={onClose} className="text-sm text-muted-foreground hover:text-primary px-3 py-2">Cancel</button>
            <button type="submit" disabled={submitting} className="bg-primary text-primary-foreground rounded-md px-5 py-2.5 text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
              {submitting ? "Adding…" : "Add Client"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", required }: { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">{label}{required && " *"}</label>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
    </div>
  );
}

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 capitalize"
      >
        {children}
      </select>
    </div>
  );
}
