import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Search, ExternalLink, Instagram, Mail, Phone, X, Check, GitMerge } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { shortDate } from "@/lib/dates";
import { toast } from "sonner";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

export const Route = createFileRoute("/studio/rolodex")({
  component: RolodexPage,
});

// Normalize a name the same way the DB does — lowercase, alnum + spaces, collapsed.
function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

type VendorCategory =
  | "planner" | "florist" | "caterer" | "dj_band" | "videographer"
  | "officiant" | "hair" | "makeup" | "baker" | "rentals"
  | "stationery" | "venue" | "transportation" | "photo_booth" | "other";

const CATEGORIES: { value: VendorCategory; label: string }[] = [
  { value: "planner", label: "Planner / Coordinator" },
  { value: "venue", label: "Venue" },
  { value: "florist", label: "Florist" },
  { value: "caterer", label: "Caterer" },
  { value: "baker", label: "Baker / Cake" },
  { value: "dj_band", label: "DJ / Band" },
  { value: "videographer", label: "Videographer" },
  { value: "officiant", label: "Officiant" },
  { value: "hair", label: "Hair" },
  { value: "makeup", label: "Makeup" },
  { value: "rentals", label: "Rentals" },
  { value: "stationery", label: "Stationery" },
  { value: "transportation", label: "Transportation" },
  { value: "photo_booth", label: "Photo Booth" },
  { value: "other", label: "Other" },
];
const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));

type Vendor = {
  id: string;
  name: string;
  category: string;
  website: string | null;
  instagram: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  preferred_blurb: string | null;
  is_verified: boolean;
  is_preferred: boolean;
  created_at: string;
  couples_count: number;
};

type StatusFilter = "all" | "unverified" | "preferred";

function RolodexPage() {
  const { roles, profile } = useAuth();
  const canEdit = roles.includes("owner") || roles.includes("studio_manager");
  const isOwner = roles.includes("owner");

  const [rows, setRows] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [openMergeOnEdit, setOpenMergeOnEdit] = useState(false);
  const [importing, setImporting] = useState(false);

  const logVendor = async (action: string, vendor: Vendor, extra: Record<string, unknown> = {}) => {
    try {
      await supabase.from("activity_log").insert({
        user_id: profile?.id ?? null,
        action_type: action,
        target_type: "vendor",
        target_id: vendor.id,
        description: `${action} — ${vendor.name}`,
        metadata: { vendor_id: vendor.id, vendor_name: vendor.name, category: vendor.category, ...extra },
      });
    } catch { /* swallow */ }
  };

  const quickVerify = async (v: Vendor, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canEdit) return;
    const { error } = await supabase.from("vendors").update({ is_verified: true }).eq("id", v.id);
    if (error) return toast.error(error.message);
    toast.success(`Verified ${v.name}`);
    setRows((rs) => rs.map((r) => (r.id === v.id ? { ...r, is_verified: true } : r)));
    void logVendor("vendor.verified", v, { source: "quick_action" });
  };

  const openMerge = (v: Vendor, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canEdit) return;
    setOpenMergeOnEdit(true);
    setEditing(v);
  };

  const runBackfill = async () => {
    if (!isOwner) return;
    if (!window.confirm("Import vendors from couples' questionnaire answers?\n\nThis scans every wedding questionnaire for florist/caterer/DJ/etc. entries and adds them to the Rolodex. Safe to re-run — duplicates are skipped.")) return;
    setImporting(true);
    const { data, error } = await supabase.rpc("backfill_vendors_from_questionnaires");
    setImporting(false);
    if (error) return toast.error(error.message);
    const summary = (data ?? {}) as { vendors_created?: number; links_created?: number; skipped?: number };
    toast.success(
      `Imported · ${summary.vendors_created ?? 0} new vendors, ${summary.links_created ?? 0} couple links, ${summary.skipped ?? 0} skipped`
    );
    load();
  };
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const load = async () => {
    setLoading(true);
    const { data: vendors, error } = await supabase
      .from("vendors")
      .select("id, name, category, website, instagram, email, phone, address, notes, preferred_blurb, is_verified, is_preferred, created_at")
      .is("merged_into_vendor_id", null)
      .order("name");
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    const ids = (vendors ?? []).map((v) => v.id);
    const counts = new Map<string, number>();
    if (ids.length) {
      const { data: links } = await supabase
        .from("wedding_vendors")
        .select("vendor_id")
        .in("vendor_id", ids);
      (links ?? []).forEach((l: any) => counts.set(l.vendor_id, (counts.get(l.vendor_id) ?? 0) + 1));
    }
    setRows((vendors ?? []).map((v: any) => ({ ...v, couples_count: counts.get(v.id) ?? 0 })));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const visible = useMemo(() => {
    let v = rows;
    if (statusFilter === "unverified") v = v.filter((r) => !r.is_verified);
    if (statusFilter === "preferred") v = v.filter((r) => r.is_preferred);
    if (categoryFilter !== "all") v = v.filter((r) => r.category === categoryFilter);
    if (search.trim()) {
      const s = search.toLowerCase();
      v = v.filter((r) => r.name.toLowerCase().includes(s));
    }
    // Unverified first, then by name
    return [...v].sort((a, b) => {
      if (a.is_verified !== b.is_verified) return a.is_verified ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  }, [rows, statusFilter, categoryFilter, search]);

  const unverifiedCount = rows.filter((r) => !r.is_verified).length;
  const preferredCount = rows.filter((r) => r.is_preferred).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="font-serif italic text-[28px] text-primary leading-tight">Vendor Rolodex</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Florists, caterers, planners, and other wedding vendors added by couples or the studio.
            {!canEdit && <> Read-only.</>}
          </p>
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Total vendors" value={rows.length} />
        <Stat label="Unverified" value={unverifiedCount} />
        <Stat label="Preferred" value={preferredCount} />
        <Stat label="Couples linked" value={rows.reduce((s, r) => s + r.couples_count, 0)} />
      </div>

      <div className="bg-surface border-t-2 border-gold rounded-lg shadow-soft p-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search vendors by name"
            className="w-full pl-9 pr-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="flex gap-2">
          <Chip active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>All</Chip>
          <Chip active={statusFilter === "unverified"} onClick={() => setStatusFilter("unverified")}>
            Unverified (needs review){unverifiedCount ? ` · ${unverifiedCount}` : ""}
          </Chip>
          <Chip active={statusFilter === "preferred"} onClick={() => setStatusFilter("preferred")}>
            Preferred{preferredCount ? ` · ${preferredCount}` : ""}
          </Chip>
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-3 py-2 bg-background border border-border rounded-md text-sm"
        >
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="font-serif italic text-primary p-8">Loading…</p>
      ) : visible.length === 0 ? (
        <div className="bg-surface rounded-lg shadow-soft py-20 text-center border-t-2 border-gold">
          <p className="font-serif italic text-2xl text-primary">No vendors match these filters.</p>
          <p className="text-sm text-muted-foreground mt-2">
            Vendors appear here as couples add them in their portal.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((v) => (
            <div
              key={v.id}
              onClick={() => { setOpenMergeOnEdit(false); setEditing(v); }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter") { setOpenMergeOnEdit(false); setEditing(v); } }}
              className="w-full text-left bg-surface rounded-lg shadow-soft border-t-2 border-gold p-4 flex flex-col md:flex-row md:items-center gap-4 hover:bg-background-alt/40 transition-colors cursor-pointer"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-3 flex-wrap">
                  <h3 className="font-serif italic text-lg text-primary">{v.name}</h3>
                  <span className="text-[10px] uppercase tracking-wider bg-background-alt text-primary px-2 py-0.5 rounded-sm">
                    {CATEGORY_LABEL[v.category] ?? v.category}
                  </span>
                  {!v.is_verified && (
                    <span className="text-[10px] uppercase tracking-wider bg-amber-100 text-amber-800 px-2 py-0.5 rounded-sm">
                      Unverified
                    </span>
                  )}
                  {v.is_verified && (
                    <span className="text-[10px] uppercase tracking-wider bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-sm">
                      Verified
                    </span>
                  )}
                  {v.is_preferred && (
                    <span className="text-[10px] uppercase tracking-wider bg-gold/30 text-plum px-2 py-0.5 rounded-sm">
                      Preferred
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1.5 flex flex-wrap gap-3">
                  <span>{v.couples_count} {v.couples_count === 1 ? "couple" : "couples"} using</span>
                  <span>·</span>
                  <span>Added {shortDate(v.created_at)}</span>
                  {v.website && <a href={v.website} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-magenta hover:underline inline-flex items-center gap-1">Website <ExternalLink size={10} /></a>}
                  {v.instagram && <a href={v.instagram.startsWith("http") ? v.instagram : `https://instagram.com/${v.instagram.replace("@", "")}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-magenta hover:underline inline-flex items-center gap-1"><Instagram size={10} /> IG</a>}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {canEdit && !v.is_verified && (
                  <button
                    type="button"
                    onClick={(e) => quickVerify(v, e)}
                    className="text-xs inline-flex items-center gap-1 border border-emerald-300 text-emerald-800 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1.5 rounded-md"
                  >
                    <Check size={12} /> Verify
                  </button>
                )}
                {canEdit && (
                  <button
                    type="button"
                    onClick={(e) => openMerge(v, e)}
                    className="text-xs inline-flex items-center gap-1 border border-border text-muted-foreground hover:text-primary px-2.5 py-1.5 rounded-md"
                    title="Merge into another vendor"
                  >
                    <GitMerge size={12} /> Merge
                  </button>
                )}
                <span className="text-xs text-muted-foreground">{canEdit ? "Edit →" : "View →"}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <VendorEditorModal
          vendor={editing}
          allVendors={rows}
          canEdit={canEdit}
          startInMergeMode={openMergeOnEdit}
          onClose={() => { setEditing(null); setOpenMergeOnEdit(false); }}
          onSaved={() => { setEditing(null); setOpenMergeOnEdit(false); load(); }}
        />
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 rounded-md text-xs border ${
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background text-muted-foreground border-border hover:text-primary"
      }`}
    >
      {children}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-surface rounded-lg shadow-soft border-t-2 border-gold p-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="font-serif text-[28px] text-primary leading-none mt-2">{value}</p>
    </div>
  );
}

type CoupleLink = { id: string; client_id: string; couple_label: string };

function VendorEditorModal({
  vendor, allVendors, canEdit, startInMergeMode, onClose, onSaved,
}: {
  vendor: Vendor;
  allVendors: Vendor[];
  canEdit: boolean;
  startInMergeMode?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: vendor.name,
    category: vendor.category,
    website: vendor.website ?? "",
    instagram: vendor.instagram ?? "",
    email: vendor.email ?? "",
    phone: vendor.phone ?? "",
    address: vendor.address ?? "",
    notes: vendor.notes ?? "",
    preferred_blurb: vendor.preferred_blurb ?? "",
    is_verified: vendor.is_verified,
    is_preferred: vendor.is_preferred,
  });
  const [saving, setSaving] = useState(false);
  const [couples, setCouples] = useState<CoupleLink[]>([]);
  const [showMerge, setShowMerge] = useState(!!startInMergeMode);
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);
  const [mergeQuery, setMergeQuery] = useState("");
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("wedding_vendors")
        .select("id, client_id, client:clients(id, couple_name_1, couple_name_2)")
        .eq("vendor_id", vendor.id);
      const list: CoupleLink[] = ((data ?? []) as any[]).map((r) => {
        const c = r.client;
        const label = c
          ? [c.couple_name_1, c.couple_name_2].filter(Boolean).join(" & ") || "Untitled couple"
          : "Unknown";
        return { id: r.id, client_id: r.client_id, couple_label: label };
      });
      setCouples(list);
    })();
  }, [vendor.id]);

  const save = async () => {
    if (!canEdit) return;
    if (!form.name.trim()) return toast.error("Name is required");
    setSaving(true);
    const { error } = await supabase
      .from("vendors")
      .update({
        name: form.name.trim(),
        category: form.category,
        website: form.website.trim() || null,
        instagram: form.instagram.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        notes: form.notes.trim() || null,
        preferred_blurb: form.preferred_blurb.trim() || null,
        is_verified: form.is_verified,
        is_preferred: form.is_preferred,
      })
      .eq("id", vendor.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Vendor updated");
    onSaved();
  };

  const doMerge = async () => {
    if (!canEdit || !mergeTargetId) return;
    const target = allVendors.find((v) => v.id === mergeTargetId);
    if (!target) return toast.error("Pick a vendor to merge into");
    const n = couples.length;
    const msg = `Merge "${vendor.name}" into "${target.name}"?\n\nAll ${n} ${n === 1 ? "couple" : "couples"} will move to "${target.name}" and this entry will be retired. This cannot be undone.`;
    if (!window.confirm(msg)) return;
    setMerging(true);
    const { error } = await supabase.rpc("merge_vendors", { _loser: vendor.id, _winner: target.id });
    setMerging(false);
    if (error) return toast.error(error.message);
    toast.success(`Merged into ${target.name}`);
    onSaved();
  };

  // Rank merge candidates: similar name first, then same category, then rest.
  const mergeCandidates = useMemo(() => {
    const myNorm = normalizeName(vendor.name);
    const myFirst = myNorm.split(" ")[0] ?? "";
    return allVendors
      .filter((v) => v.id !== vendor.id)
      .map((v) => {
        const n = normalizeName(v.name);
        let score = 0;
        if (n === myNorm) score = 100;
        else if (n.includes(myNorm) || myNorm.includes(n)) score = 80;
        else if (myFirst && n.startsWith(myFirst)) score = 50;
        if (v.category === vendor.category) score += 10;
        return { v, score };
      })
      .sort((a, b) => b.score - a.score || a.v.name.localeCompare(b.v.name))
      .map((x) => x.v);
  }, [allVendors, vendor.id, vendor.name, vendor.category]);

  const filteredCandidates = useMemo(() => {
    const q = mergeQuery.trim().toLowerCase();
    if (!q) return mergeCandidates.slice(0, 50);
    return mergeCandidates.filter((v) => v.name.toLowerCase().includes(q)).slice(0, 50);
  }, [mergeCandidates, mergeQuery]);

  const readOnly = !canEdit;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start md:items-center justify-center p-4 overflow-y-auto">
      <div className="bg-surface rounded-lg shadow-elevated border-t-2 border-gold w-full max-w-2xl my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="font-serif italic text-xl text-primary">{canEdit ? "Edit vendor" : "Vendor details"}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{CATEGORY_LABEL[vendor.category] ?? vendor.category}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-primary" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Name">
              <input disabled={readOnly} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" />
            </Field>
            <Field label="Category">
              <select disabled={readOnly} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="input">
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Website">
              <input disabled={readOnly} value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} className="input" placeholder="https://…" />
            </Field>
            <Field label="Instagram">
              <input disabled={readOnly} value={form.instagram} onChange={(e) => setForm({ ...form, instagram: e.target.value })} className="input" placeholder="@handle or URL" />
            </Field>
            <Field label="Email">
              <input disabled={readOnly} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input" type="email" />
            </Field>
            <Field label="Phone">
              <input disabled={readOnly} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="input" />
            </Field>
            <div className="md:col-span-2">
              <Field label="Address">
                <input disabled={readOnly} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="input" />
              </Field>
            </div>
            <div className="md:col-span-2">
              <Field label="Internal notes (studio only)">
                <textarea disabled={readOnly} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="input min-h-[80px]" />
              </Field>
            </div>
          </div>

          <div className="border-t border-border pt-4 space-y-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                disabled={readOnly}
                checked={form.is_verified}
                onChange={(e) => setForm({ ...form, is_verified: e.target.checked })}
              />
              <span className="text-sm text-foreground">Verified <span className="text-muted-foreground text-xs">(studio has confirmed the vendor's details)</span></span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                disabled={readOnly}
                checked={form.is_preferred}
                onChange={(e) => setForm({ ...form, is_preferred: e.target.checked })}
              />
              <span className="text-sm text-foreground">Preferred <span className="text-muted-foreground text-xs">(recommended to couples — appears in their portal)</span></span>
            </label>
            {form.is_preferred && (
              <Field label="Preferred blurb (shown to couples)">
                <textarea
                  disabled={readOnly}
                  value={form.preferred_blurb}
                  onChange={(e) => setForm({ ...form, preferred_blurb: e.target.value })}
                  className="input min-h-[60px]"
                  placeholder="Why we love working with them…"
                />
              </Field>
            )}
          </div>

          <div className="border-t border-border pt-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
              Used by ({couples.length})
            </p>
            {couples.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No couples linked yet.</p>
            ) : (
              <ul className="space-y-1">
                {couples.map((c) => (
                  <li key={c.id}>
                    <Link
                      to="/studio/clients/$id"
                      params={{ id: c.client_id }}
                      className="text-sm text-magenta hover:underline"
                      onClick={onClose}
                    >
                      {c.couple_label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {(vendor.email || vendor.phone) && (
            <div className="text-xs text-muted-foreground flex flex-wrap gap-3 border-t border-border pt-3">
              {vendor.email && <span className="inline-flex items-center gap-1"><Mail size={12} /> {vendor.email}</span>}
              {vendor.phone && <span className="inline-flex items-center gap-1"><Phone size={12} /> {vendor.phone}</span>}
            </div>
          )}

          {canEdit && (
            <div className="border-t border-border pt-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Merge duplicates</p>
                {!showMerge ? (
                  <button
                    type="button"
                    onClick={() => setShowMerge(true)}
                    className="text-xs inline-flex items-center gap-1 border border-border text-muted-foreground hover:text-primary px-2.5 py-1.5 rounded-md"
                  >
                    <GitMerge size={12} /> Merge into…
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setShowMerge(false); setMergeTargetId(null); setMergeQuery(""); }}
                    className="text-xs text-muted-foreground hover:text-primary"
                  >
                    Cancel merge
                  </button>
                )}
              </div>
              {showMerge && (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Pick the vendor to keep. All {couples.length} {couples.length === 1 ? "couple" : "couples"} linked to <span className="italic">{vendor.name}</span> will move to it; this entry is retired.
                  </p>
                  <div className="border border-border rounded-md overflow-hidden">
                    <Command shouldFilter={false}>
                      <CommandInput placeholder="Search vendors to merge into…" value={mergeQuery} onValueChange={setMergeQuery} />
                      <CommandList>
                        <CommandEmpty>No vendors found.</CommandEmpty>
                        <CommandGroup>
                          {filteredCandidates.map((c) => {
                            const myNorm = normalizeName(vendor.name);
                            const cn = normalizeName(c.name);
                            const likelyDup = cn === myNorm || cn.includes(myNorm) || myNorm.includes(cn);
                            const sameCat = c.category === vendor.category;
                            return (
                              <CommandItem
                                key={c.id}
                                value={c.id}
                                onSelect={() => setMergeTargetId(c.id)}
                                className={mergeTargetId === c.id ? "bg-primary/10" : ""}
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm">{c.name}</span>
                                    {likelyDup && (
                                      <span className="text-[9px] uppercase tracking-wider bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-sm">
                                        Likely duplicate
                                      </span>
                                    )}
                                    {sameCat && !likelyDup && (
                                      <span className="text-[9px] uppercase tracking-wider bg-background-alt text-primary px-1.5 py-0.5 rounded-sm">
                                        Same category
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[11px] text-muted-foreground">{CATEGORY_LABEL[c.category] ?? c.category}</p>
                                </div>
                                {mergeTargetId === c.id && <Check size={14} className="text-primary" />}
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={doMerge}
                      disabled={!mergeTargetId || merging}
                      className="text-xs inline-flex items-center gap-1 bg-amber-700 text-white px-3 py-2 rounded-md hover:bg-amber-800 disabled:opacity-50"
                    >
                      <GitMerge size={12} /> {merging ? "Merging…" : "Merge vendors"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border flex justify-end gap-2">
          <button onClick={onClose} className="text-xs border border-border text-muted-foreground px-4 py-2 rounded-md hover:text-primary">
            {canEdit ? "Cancel" : "Close"}
          </button>
          {canEdit && (
            <button
              onClick={save}
              disabled={saving}
              className="text-xs bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          )}
        </div>
      </div>

      <style>{`.input{width:100%;padding:0.5rem 0.75rem;background:hsl(var(--background));border:1px solid hsl(var(--border));border-radius:0.375rem;font-size:0.875rem;color:hsl(var(--foreground));}
      .input:focus{outline:none;box-shadow:0 0 0 2px hsl(var(--primary)/0.2);}
      .input:disabled{opacity:0.7;cursor:not-allowed;}`}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
