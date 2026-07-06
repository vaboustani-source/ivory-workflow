import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { X, Upload, Download, Eye, EyeOff, Trash2, FileCheck2 } from "lucide-react";
import { CONTRACTOR_ROLES, type ContractorRole } from "@/lib/contractors";
import { useAuth } from "@/lib/auth";
import { shortDate } from "@/lib/dates";
import { sendContractorW9Request } from "@/lib/contractorW9.functions";

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
  default_hourly_rate: number | null;
  instagram: string | null;
  portfolio_url: string | null;
  bio: string | null;
  is_active: boolean;
  notes: string | null;
  jobs_count: number;
  last_worked_with_at: string | null;
  // W-9 / 1099 fields (visible only to owner + studio_manager)
  legal_name?: string | null;
  mailing_address?: string | null;
  business_type?: string | null;
  tax_id_type?: string | null;
  tax_id_vault_secret_id?: string | null;
  w9_collected?: boolean;
  w9_collected_at?: string | null;
  w9_requested_at?: string | null;
  w9_file_path?: string | null;
  w9_original_filename?: string | null;
}

interface Props {
  existing?: ContractorRow | null;
  onClose: () => void;
  onSaved: () => void;
}

const BUSINESS_TYPES: { value: string; label: string }[] = [
  { value: "individual", label: "Individual" },
  { value: "sole_proprietor", label: "Sole proprietor" },
  { value: "single_member_llc", label: "Single-member LLC" },
  { value: "c_corp", label: "C corporation" },
  { value: "s_corp", label: "S corporation" },
  { value: "partnership", label: "Partnership" },
  { value: "trust", label: "Trust / estate" },
  { value: "other", label: "Other" },
];

const BUCKET = "contractor-tax-docs";

export function ContractorEditorModal({ existing, onClose, onSaved }: Props) {
  const { roles } = useAuth();
  const canManageTax = roles.includes("owner") || roles.includes("studio_manager");

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
    default_hourly_rate: existing?.default_hourly_rate?.toString() ?? "",
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
      default_hourly_rate: form.default_hourly_rate ? Number(form.default_hourly_rate) : null,
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
              <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </Field>
            <Field label="Email *">
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </Field>
            <Field label="Phone">
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20" />
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
            <input value={form.homebase_address} onChange={(e) => setForm({ ...form, homebase_address: e.target.value })} placeholder="123 Main St, Brooklyn, NY 11201" className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Min hourly rate ($)">
              <input type="number" min="0" value={form.preferred_min_hourly_rate} onChange={(e) => setForm({ ...form, preferred_min_hourly_rate: e.target.value })} className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </Field>
            <Field label="Max hourly rate ($)">
              <input type="number" min="0" value={form.preferred_max_hourly_rate} onChange={(e) => setForm({ ...form, preferred_max_hourly_rate: e.target.value })} className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </Field>
          </div>

          <Field label="Rate notes">
            <input value={form.rate_notes} onChange={(e) => setForm({ ...form, rate_notes: e.target.value })} placeholder="$75 6+hr; $90 4-6hr" className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Instagram">
              <input value={form.instagram} onChange={(e) => setForm({ ...form, instagram: e.target.value })} placeholder="@handle" className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </Field>
            <Field label="Portfolio URL">
              <input value={form.portfolio_url} onChange={(e) => setForm({ ...form, portfolio_url: e.target.value })} placeholder="https://…" className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </Field>
          </div>

          <Field label="Bio">
            <textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} rows={3} className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </Field>

          <Field label="Internal notes (studio-only)">
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </Field>

          {canManageTax && existing && (
            <TaxW9Section
              contractor={existing}
              onChanged={onSaved}
            />
          )}
          {canManageTax && !existing && (
            <p className="text-xs text-muted-foreground italic border-t border-border pt-4">
              Save the contractor first, then re-open to add W-9 details.
            </p>
          )}
        </div>

        <div className="sticky bottom-0 bg-surface border-t border-gold/30 px-6 py-4 flex items-center justify-end gap-2">
          <button onClick={onClose} className="text-sm text-muted-foreground hover:text-magenta">Cancel</button>
          <button onClick={save} disabled={saving} className="bg-primary text-primary-foreground px-5 py-2 rounded-md text-sm hover:bg-primary/90 disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
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

// ============================================================================
// Tax / W-9 section — owner + studio_manager only.
// Server-side RPCs (set/get/clear_contractor_tax_id, save_contractor_w9_info,
// mark_w9_collected, clear_w9) self-check role.
// ============================================================================

function TaxW9Section({
  contractor,
  onChanged,
}: {
  contractor: ContractorRow;
  onChanged: () => void;
}) {
  const [legalName, setLegalName] = useState(contractor.legal_name ?? "");
  const [mailingAddress, setMailingAddress] = useState(contractor.mailing_address ?? "");
  const [businessType, setBusinessType] = useState(contractor.business_type ?? "");
  const [taxIdType, setTaxIdType] = useState<"ssn" | "ein">(
    (contractor.tax_id_type as "ssn" | "ein") ?? "ssn",
  );
  const [taxIdInput, setTaxIdInput] = useState("");
  const [revealedTaxId, setRevealedTaxId] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [savingInfo, setSavingInfo] = useState(false);
  const [savingTaxId, setSavingTaxId] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [marking, setMarking] = useState(false);
  const [collected, setCollected] = useState(!!contractor.w9_collected);
  const [collectedAt, setCollectedAt] = useState(contractor.w9_collected_at ?? null);
  const [filePath, setFilePath] = useState(contractor.w9_file_path ?? null);
  const [origFilename, setOrigFilename] = useState(contractor.w9_original_filename ?? null);
  const [hasTaxId, setHasTaxId] = useState(!!contractor.tax_id_vault_secret_id);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const saveInfo = async () => {
    setSavingInfo(true);
    const { error } = await supabase.rpc("save_contractor_w9_info", {
      _contractor_id: contractor.id,
      _legal_name: legalName,
      _mailing_address: mailingAddress,
      _business_type: (businessType || null) as string,
    });
    setSavingInfo(false);
    if (error) return toast.error(error.message);
    toast.success("W-9 info saved");
    onChanged();
  };

  const saveTaxId = async () => {
    const trimmed = taxIdInput.trim();
    if (!trimmed) return toast.error("Enter a tax ID number");
    setSavingTaxId(true);
    const { error } = await supabase.rpc("set_contractor_tax_id", {
      _contractor_id: contractor.id,
      _plaintext: trimmed,
      _type: taxIdType,
    });
    setSavingTaxId(false);
    if (error) return toast.error(error.message);
    setTaxIdInput("");
    setRevealedTaxId(null);
    setHasTaxId(true);
    toast.success("Tax ID encrypted and saved");
    onChanged();
  };

  const reveal = async () => {
    if (revealedTaxId) {
      setRevealedTaxId(null);
      return;
    }
    setRevealing(true);
    const { data, error } = await supabase.rpc("get_contractor_tax_id", {
      _contractor_id: contractor.id,
    });
    setRevealing(false);
    if (error) return toast.error(error.message);
    if (!data) return toast.error("No tax ID on file");
    setRevealedTaxId(data as string);
  };

  const removeTaxId = async () => {
    if (!confirm("Remove the encrypted tax ID for this contractor?")) return;
    const { error } = await supabase.rpc("clear_contractor_tax_id", {
      _contractor_id: contractor.id,
    });
    if (error) return toast.error(error.message);
    setHasTaxId(false);
    setRevealedTaxId(null);
    toast.success("Tax ID removed");
    onChanged();
  };

  const handleFile = async (file: File, displayName: string) => {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      return toast.error("W-9 file must be a PDF");
    }
    if (file.size > 10 * 1024 * 1024) {
      return toast.error("File too large (max 10 MB)");
    }
    setUploading(true);
    const safeName = displayName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "w9.pdf";
    const path = `${contractor.id}/${Date.now()}-${safeName.endsWith(".pdf") ? safeName : safeName + ".pdf"}`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: "application/pdf", upsert: false });
    if (upErr) {
      setUploading(false);
      return toast.error(upErr.message);
    }
    // Replace any existing file
    if (filePath && filePath !== path) {
      await supabase.storage.from(BUCKET).remove([filePath]).catch(() => {});
    }
    const { error: markErr } = await supabase.rpc("mark_w9_collected", {
      _contractor_id: contractor.id,
      _file_path: path,
      _filename: safeName,
    });
    setUploading(false);
    if (markErr) return toast.error(markErr.message);
    setFilePath(path);
    setOrigFilename(safeName);
    setCollected(true);
    setCollectedAt(new Date().toISOString());
    await supabase.from("activity_log").insert({
      action_type: "contractor_w9.collected",
      target_type: "contractor",
      target_id: contractor.id,
      description: `W-9 filed for ${contractor.full_name}`,
      metadata: { contractor_id: contractor.id, source: "upload" } as never,
    });
    toast.success("W-9 filed");
    onChanged();
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const def = (legalName || contractor.full_name || file.name).trim();
    const display = prompt("Filename for this W-9 (PDF)", def) ?? def;
    await handleFile(file, display);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const markCollectedOnly = async () => {
    setMarking(true);
    const { error } = await supabase.rpc("mark_w9_collected", {
      _contractor_id: contractor.id,
      _file_path: null as unknown as string,
      _filename: null as unknown as string,
    });
    setMarking(false);
    if (error) return toast.error(error.message);
    setCollected(true);
    setCollectedAt((prev) => prev ?? new Date().toISOString());
    await supabase.from("activity_log").insert({
      action_type: "contractor_w9.collected",
      target_type: "contractor",
      target_id: contractor.id,
      description: `W-9 marked collected for ${contractor.full_name}`,
      metadata: { contractor_id: contractor.id, source: "manual" } as never,
    });
    toast.success("Marked as collected");
    onChanged();
  };

  const download = async () => {
    if (!filePath) return;
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(filePath, 60);
    if (error || !data?.signedUrl) return toast.error(error?.message ?? "Couldn't open file");
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const clearAll = async () => {
    if (!confirm("Clear W-9 status and delete the filed PDF?")) return;
    const { data: prior, error } = await supabase.rpc("clear_w9", { _contractor_id: contractor.id });
    if (error) return toast.error(error.message);
    if (prior) await supabase.storage.from(BUCKET).remove([prior as unknown as string]).catch(() => {});
    setCollected(false);
    setCollectedAt(null);
    setFilePath(null);
    setOrigFilename(null);
    toast.success("W-9 cleared");
    onChanged();
  };

  return (
    <div className="border-t-2 border-gold pt-5 mt-2 space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-serif italic text-lg text-primary">Tax / W-9</h3>
        <StatusBadge collected={collected} collectedAt={collectedAt} requestedAt={contractor.w9_requested_at ?? null} />
      </div>
      <p className="text-[11px] text-muted-foreground -mt-2">
        Owner + studio manager only. Tax ID is encrypted at rest in Vault.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Legal name (W-9 line 1)">
          <input value={legalName} onChange={(e) => setLegalName(e.target.value)} className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20" />
        </Field>
        <Field label="Tax classification">
          <select value={businessType} onChange={(e) => setBusinessType(e.target.value)} className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm text-foreground">
            <option value="">—</option>
            {BUSINESS_TYPES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Mailing address (where the 1099 is sent)">
        <textarea value={mailingAddress} onChange={(e) => setMailingAddress(e.target.value)} rows={2} className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20" />
      </Field>
      <div className="flex justify-between items-center gap-2">
        <SendW9Button contractorId={contractor.id} disabled={collected} />
        <button onClick={saveInfo} disabled={savingInfo} className="text-xs border border-gold text-gold px-3 py-1.5 rounded-md hover:bg-gold/10 disabled:opacity-50">
          {savingInfo ? "Saving…" : "Save W-9 info"}
        </button>
      </div>

      <div className="border border-border rounded-md p-4 space-y-3 bg-background-alt">
        <div className="flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Tax ID number (SSN / EIN)</p>
          {hasTaxId && (
            <div className="flex items-center gap-2">
              <button onClick={reveal} disabled={revealing} className="text-xs text-gold hover:underline inline-flex items-center gap-1 disabled:opacity-50">
                {revealedTaxId ? <EyeOff size={12} /> : <Eye size={12} />}
                {revealing ? "Working…" : revealedTaxId ? "Hide" : "Reveal"}
              </button>
              <button onClick={removeTaxId} className="text-xs text-magenta hover:underline inline-flex items-center gap-1">
                <Trash2 size={12} /> Remove
              </button>
            </div>
          )}
        </div>
        {hasTaxId ? (
          <div className="font-mono text-sm text-foreground">
            {revealedTaxId ?? "•••-••-••••"}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">No tax ID on file.</p>
        )}
        <div className="flex flex-col md:flex-row gap-2 pt-1">
          <select value={taxIdType} onChange={(e) => setTaxIdType(e.target.value as "ssn" | "ein")} className="px-3 py-2 bg-background border border-border rounded-md text-sm">
            <option value="ssn">SSN</option>
            <option value="ein">EIN</option>
          </select>
          <input
            value={taxIdInput}
            onChange={(e) => setTaxIdInput(e.target.value)}
            placeholder={hasTaxId ? "Enter to rotate…" : "123-45-6789 or 12-3456789"}
            inputMode="numeric"
            autoComplete="off"
            className="flex-1 px-3 py-2 bg-background border border-border rounded-md text-sm font-mono"
          />
          <button onClick={saveTaxId} disabled={savingTaxId || !taxIdInput.trim()} className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90 disabled:opacity-50">
            {savingTaxId ? "Saving…" : hasTaxId ? "Rotate" : "Save"}
          </button>
        </div>
      </div>

      <div className="border border-border rounded-md p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Signed W-9 PDF</p>
          {(collected || filePath) && (
            <button onClick={clearAll} className="text-xs text-magenta hover:underline inline-flex items-center gap-1">
              <Trash2 size={12} /> Clear
            </button>
          )}
        </div>
        {filePath ? (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1 flex items-center gap-2 text-sm text-foreground">
              <FileCheck2 size={14} className="text-sage shrink-0" />
              <span className="truncate">{origFilename ?? "W-9.pdf"}</span>
            </div>
            <button onClick={download} className="text-xs border border-gold text-gold px-3 py-1.5 rounded-md hover:bg-gold/10 inline-flex items-center gap-1">
              <Download size={12} /> Download
            </button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">No PDF on file.</p>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90 disabled:opacity-50"
          >
            <Upload size={14} /> {uploading ? "Uploading…" : filePath ? "Replace PDF" : "Upload W-9 PDF"}
          </button>
          {!collected && (
            <button
              onClick={markCollectedOnly}
              disabled={marking}
              className="text-xs border border-border text-muted-foreground px-3 py-2 rounded-md hover:text-primary disabled:opacity-50"
            >
              {marking ? "Marking…" : "Mark collected without file"}
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={onPickFile}
            className="hidden"
          />
        </div>
      </div>
    </div>
  );
}

function StatusBadge({
  collected,
  collectedAt,
  requestedAt,
}: {
  collected: boolean;
  collectedAt: string | null;
  requestedAt: string | null;
}) {
  if (collected) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider bg-sage/20 text-sage px-2 py-1 rounded-full">
        On file{collectedAt && <> · {shortDate(collectedAt)}</>}
      </span>
    );
  }
  if (requestedAt) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider bg-gold/20 text-gold px-2 py-1 rounded-full">
        Requested {shortDate(requestedAt)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider bg-muted text-muted-foreground px-2 py-1 rounded-full">
      Not requested
    </span>
  );
}

function SendW9Button({ contractorId, disabled }: { contractorId: string; disabled?: boolean }) {
  const [sending, setSending] = useState(false);
  const send = async () => {
    if (disabled) return;
    if (!confirm("Send the W-9 request email to this contractor now?")) return;
    setSending(true);
    try {
      // sendContractorW9Request imported at module scope
      const res = await sendContractorW9Request({
        data: { contractorId, taxYear: new Date().getFullYear() },
      });
      if (res?.ok) toast.success(res.status === "test_mode_blocked" ? "Logged (Postmark test mode)" : "W-9 request sent");
      else toast.error(res?.error ?? "Send failed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  };
  return (
    <button
      onClick={send}
      disabled={disabled || sending}
      title={disabled ? "W-9 already on file" : "Send W-9 request email"}
      className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-40"
    >
      {sending ? "Sending…" : "Send W-9 request"}
    </button>
  );
}
