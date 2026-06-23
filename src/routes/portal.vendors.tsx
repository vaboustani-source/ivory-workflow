import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, ExternalLink, Instagram, Mail, Phone, X, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PortalGate } from "@/components/PortalLayout";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";

export const Route = createFileRoute("/portal/vendors")({
  component: PortalVendorsRoute,
});

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

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.value, c.label]),
);

type Row = {
  id: string; // wedding_vendor_id
  role_label: string | null;
  couple_notes: string | null;
  point_of_contact: string | null;
  point_of_contact_phone: string | null;
  point_of_contact_email: string | null;
  vendor: {
    id: string;
    name: string;
    category: string;
    website: string | null;
    instagram: string | null;
    email: string | null;
    phone: string | null;
    is_preferred: boolean;
    is_verified: boolean;
  };
};

type Recommendation = {
  vendor_id: string;
  name: string;
  category: string;
  website: string | null;
  instagram: string | null;
  preferred_blurb: string | null;
};

function PortalVendorsRoute() {
  return <PortalGate>{({ clientId, client }) => (
    <PortalVendorsPage clientId={clientId} isLead={client.status === "lead"} />
  )}</PortalGate>;
}

function PortalVendorsPage({ clientId, isLead }: { clientId: string; isLead: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);

  const load = async () => {
    setLoading(true);
    const [mineRes, recRes] = await Promise.all([
      supabase.rpc("couple_my_vendors", { _client_id: clientId }),
      supabase.rpc("couple_recommended_vendors", { _client_id: clientId }),
    ]);
    if (mineRes.error) toast.error(mineRes.error.message);
    const mapped: Row[] = ((mineRes.data ?? []) as any[]).map((r) => ({
      id: r.wedding_vendor_id,
      role_label: r.role_label,
      couple_notes: r.couple_notes,
      point_of_contact: r.point_of_contact,
      point_of_contact_phone: r.point_of_contact_phone,
      point_of_contact_email: r.point_of_contact_email,
      vendor: {
        id: r.vendor_id,
        name: r.vendor_name,
        category: r.vendor_category,
        website: r.website,
        instagram: r.instagram,
        email: r.email,
        phone: r.phone,
        is_preferred: r.is_preferred,
        is_verified: r.is_verified,
      },
    }));
    setRows(mapped);
    setRecs(((recRes.data ?? []) as any[]));
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [clientId]);

  const grouped = CATEGORIES
    .map((c) => ({ category: c, items: rows.filter((r) => r.vendor.category === c.value) }))
    .filter((g) => g.items.length > 0);

  const recsByCategory = useMemo(() => {
    const m = new Map<string, Recommendation[]>();
    recs.forEach((r) => {
      const arr = m.get(r.category) ?? [];
      arr.push(r);
      m.set(r.category, arr);
    });
    return Array.from(m.entries());
  }, [recs]);

  const addRecommended = async (rec: Recommendation) => {
    const { error } = await supabase.rpc("add_vendor_for_client", {
      _client_id: clientId,
      _name: rec.name,
      _category: rec.category,
    } as any);
    if (error) { toast.error(error.message); return; }
    toast.success(`${rec.name} added to your vendors`);
    load();
  };

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-serif italic text-[28px] md:text-[32px] text-primary">Your vendors</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Keep your wedding team in one place — florists, caterers, planners, and everyone in between.
          </p>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-2 bg-primary text-background px-4 py-2 rounded-md text-sm hover:opacity-90"
        >
          <Plus size={16} /> Add vendor
        </button>
      </header>

      {isLead && (
        <div className="bg-surface border border-gold/30 rounded-lg p-4 text-sm text-muted-foreground">
          You can start adding vendors anytime — they'll come with you once you book.
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          {rows.length === 0 ? (
            <div className="bg-surface rounded-lg shadow-soft p-12 text-center border-t-2 border-gold">
              <p className="font-serif italic text-2xl text-primary">No vendors yet.</p>
              <p className="text-sm text-muted-foreground mt-3 max-w-md mx-auto">
                Add your florist, caterer, DJ, planner and anyone else helping bring your day together.
              </p>
              <button
                onClick={() => setAddOpen(true)}
                className="mt-6 inline-flex items-center gap-2 bg-primary text-background px-4 py-2 rounded-md text-sm hover:opacity-90"
              >
                <Plus size={16} /> Add your first vendor
              </button>
            </div>
          ) : (
            <div className="space-y-8">
              {grouped.map((g) => (
                <section key={g.category.value}>
                  <h2 className="text-[11px] uppercase tracking-[0.18em] text-primary/55 mb-3">
                    {g.category.label}
                  </h2>
                  <div className="space-y-3">
                    {g.items.map((row) => (
                      <VendorCard key={row.id} row={row} onEdit={() => setEditing(row)} onRemoved={load} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}

          {recsByCategory.length > 0 && (
            <section className="bg-surface rounded-lg border-t-2 border-gold shadow-soft p-6">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles size={16} className="text-gold" />
                <h2 className="font-serif italic text-xl text-primary">Recommended by your studio</h2>
              </div>
              <p className="text-xs text-muted-foreground mb-5">
                Vendors Victoria has loved working with — handpicked for categories you haven't filled yet.
              </p>
              <div className="space-y-6">
                {recsByCategory.map(([cat, items]) => (
                  <div key={cat}>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-primary/55 mb-2">
                      {CATEGORY_LABEL[cat] ?? cat}
                    </p>
                    <div className="grid gap-3 md:grid-cols-2">
                      {items.map((r) => (
                        <RecommendationCard key={r.vendor_id} rec={r} onAdd={() => addRecommended(r)} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {addOpen && (
        <VendorFormModal
          clientId={clientId}
          onClose={() => setAddOpen(false)}
          onSaved={() => { setAddOpen(false); load(); }}
        />
      )}
      {editing && (
        <EditLinkModal
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function RecommendationCard({ rec, onAdd }: { rec: Recommendation; onAdd: () => void }) {
  const [busy, setBusy] = useState(false);
  const insta = rec.instagram
    ? (rec.instagram.startsWith("http") ? rec.instagram : `https://instagram.com/${rec.instagram.replace(/^@/, "")}`)
    : null;
  const handle = async () => {
    setBusy(true);
    await onAdd();
    setBusy(false);
  };
  return (
    <div className="bg-background rounded-md border border-gold/30 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-serif italic text-base text-primary">{rec.name}</p>
          {rec.preferred_blurb && (
            <p className="text-[13px] text-muted-foreground mt-1">{rec.preferred_blurb}</p>
          )}
          <div className="flex gap-3 mt-2 text-[12px]">
            {rec.website && (
              <a href={rec.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-magenta hover:underline">
                <ExternalLink size={12} /> Website
              </a>
            )}
            {insta && (
              <a href={insta} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-magenta hover:underline">
                <Instagram size={12} /> {rec.instagram}
              </a>
            )}
          </div>
        </div>
        <button
          onClick={handle}
          disabled={busy}
          className="shrink-0 inline-flex items-center gap-1 text-xs border border-gold text-gold px-3 py-1.5 rounded-md hover:bg-gold/10 disabled:opacity-50"
        >
          <Plus size={12} /> {busy ? "Adding…" : "Add to my vendors"}
        </button>
      </div>
    </div>
  );
}

function VendorCard({ row, onEdit, onRemoved }: { row: Row; onEdit: () => void; onRemoved: () => void }) {
  const v = row.vendor;
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    if (!confirm(`Remove ${v.name} from your vendors? The vendor stays in the directory.`)) return;
    setBusy(true);
    const { error } = await supabase.from("wedding_vendors").delete().eq("id", row.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Removed");
    onRemoved();
  };

  const instaUrl = v.instagram
    ? (v.instagram.startsWith("http") ? v.instagram : `https://instagram.com/${v.instagram.replace(/^@/, "")}`)
    : null;

  return (
    <div className="bg-surface rounded-lg shadow-soft p-5 border-t-2 border-gold">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-serif italic text-lg text-primary">{v.name}</p>
            {v.is_preferred && (
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-gold/20 text-gold">
                Studio pick
              </span>
            )}
          </div>
          {row.role_label && (
            <p className="text-[12px] text-muted-foreground mt-0.5">{row.role_label}</p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[12px] text-muted-foreground">
            {v.website && (
              <a href={v.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-magenta">
                <ExternalLink size={12} /> Website
              </a>
            )}
            {instaUrl && (
              <a href={instaUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-magenta">
                <Instagram size={12} /> {v.instagram}
              </a>
            )}
            {(row.point_of_contact_email || v.email) && (
              <a href={`mailto:${row.point_of_contact_email || v.email}`} className="inline-flex items-center gap-1 hover:text-magenta">
                <Mail size={12} /> {row.point_of_contact_email || v.email}
              </a>
            )}
            {(row.point_of_contact_phone || v.phone) && (
              <a href={`tel:${row.point_of_contact_phone || v.phone}`} className="inline-flex items-center gap-1 hover:text-magenta">
                <Phone size={12} /> {row.point_of_contact_phone || v.phone}
              </a>
            )}
          </div>
          {row.point_of_contact && (
            <p className="text-[12px] text-muted-foreground mt-1">Contact: {row.point_of_contact}</p>
          )}
          {row.couple_notes && (
            <p className="text-sm text-foreground/80 mt-2 whitespace-pre-wrap">{row.couple_notes}</p>
          )}
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          <button onClick={onEdit} className="text-primary/70 hover:text-magenta p-1.5 rounded" aria-label="Edit">
            <Pencil size={15} />
          </button>
          <button onClick={remove} disabled={busy} className="text-primary/70 hover:text-magenta p-1.5 rounded disabled:opacity-50" aria-label="Remove">
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------- Add (new vendor + link) with autocomplete -------- */

type SearchHit = { vendor_id: string; name: string; website: string | null; instagram: string | null };

function VendorFormModal({
  clientId, onClose, onSaved,
}: { clientId: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<VendorCategory>("florist");
  const [website, setWebsite] = useState("");
  const [instagram, setInstagram] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [roleLabel, setRoleLabel] = useState("");
  const [coupleNotes, setCoupleNotes] = useState("");
  const [poc, setPoc] = useState("");
  const [pocPhone, setPocPhone] = useState("");
  const [pocEmail, setPocEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const [matches, setMatches] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [showMatches, setShowMatches] = useState(false);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced autocomplete search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (name.trim().length < 2) { setMatches([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      const { data, error } = await supabase.rpc("couple_search_vendors", {
        _client_id: clientId,
        _category: category,
        _query: name.trim(),
      });
      setSearching(false);
      if (error) return; // silent — autocomplete is best-effort
      setMatches((data ?? []) as SearchHit[]);
    }, 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [name, category, clientId]);

  const pickMatch = (m: SearchHit) => {
    setName(m.name);
    if (m.website) setWebsite(m.website);
    if (m.instagram) setInstagram(m.instagram);
    setPickedId(m.vendor_id);
    setShowMatches(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast.error("Vendor name is required"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("add_vendor_for_client", {
      _client_id: clientId,
      _name: name.trim(),
      _category: category,
      _website: website.trim() || undefined,
      _instagram: instagram.trim() || undefined,
      _email: email.trim() || undefined,
      _phone: phone.trim() || undefined,
      _role_label: roleLabel.trim() || undefined,
      _couple_notes: coupleNotes.trim() || undefined,
      _point_of_contact: poc.trim() || undefined,
      _point_of_contact_phone: pocPhone.trim() || undefined,
      _point_of_contact_email: pocEmail.trim() || undefined,
    } as any);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Vendor added");
    onSaved();
  };

  return (
    <ModalShell title="Add a vendor" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Category">
          <select
            value={category}
            onChange={(e) => { setCategory(e.target.value as VendorCategory); setPickedId(null); }}
            className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Business name *">
          <div className="relative">
            <input
              type="text"
              required
              value={name}
              onChange={(e) => { setName(e.target.value); setPickedId(null); setShowMatches(true); }}
              onFocus={() => setShowMatches(true)}
              onBlur={() => setTimeout(() => setShowMatches(false), 150)}
              placeholder="Start typing — we'll check our directory first"
              className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background"
            />
            {showMatches && name.trim().length >= 2 && (
              <div className="absolute z-10 mt-1 w-full bg-popover border border-border rounded-md shadow-elevated overflow-hidden">
                <Command shouldFilter={false}>
                  <CommandList className="max-h-64">
                    {searching && matches.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>
                    ) : null}
                    {!searching && matches.length === 0 ? (
                      <CommandEmpty className="py-2 text-left px-3 text-xs text-muted-foreground">
                        No verified matches yet.
                      </CommandEmpty>
                    ) : null}
                    {matches.length > 0 && (
                      <CommandGroup heading="From our directory">
                        {matches.map((m) => (
                          <CommandItem
                            key={m.vendor_id}
                            value={m.vendor_id}
                            onSelect={() => pickMatch(m)}
                            className="cursor-pointer"
                          >
                            <div className="min-w-0">
                              <p className="text-sm text-foreground truncate">{m.name}</p>
                              {(m.website || m.instagram) && (
                                <p className="text-[11px] text-muted-foreground truncate">
                                  {m.website ?? m.instagram}
                                </p>
                              )}
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                    <CommandGroup>
                      <CommandItem
                        value={`__new__${name}`}
                        onSelect={() => { setPickedId(null); setShowMatches(false); }}
                        className="cursor-pointer"
                      >
                        <Plus size={14} className="mr-1.5" />
                        Add a new vendor called <span className="font-medium ml-1 truncate">"{name.trim()}"</span>
                      </CommandItem>
                    </CommandGroup>
                  </CommandList>
                </Command>
              </div>
            )}
          </div>
          {pickedId && (
            <p className="mt-1 text-[11px] text-emerald-700">✓ Linking to existing directory vendor.</p>
          )}
        </Field>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Website"><Input value={website} onChange={setWebsite} placeholder="https://…" /></Field>
          <Field label="Instagram"><Input value={instagram} onChange={setInstagram} placeholder="@handle" /></Field>
          <Field label="Email"><Input value={email} onChange={setEmail} placeholder="hello@vendor.com" type="email" /></Field>
          <Field label="Phone"><Input value={phone} onChange={setPhone} placeholder="(555) 555-5555" /></Field>
        </div>
        <Field label="What are they doing for you?">
          <Input value={roleLabel} onChange={setRoleLabel} placeholder="e.g. Day-of coordinator" />
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Your point of contact"><Input value={poc} onChange={setPoc} placeholder="Name" /></Field>
          <Field label="POC phone"><Input value={pocPhone} onChange={setPocPhone} /></Field>
          <Field label="POC email"><Input value={pocEmail} onChange={setPocEmail} type="email" /></Field>
        </div>
        <Field label="Notes (private to you)">
          <textarea
            value={coupleNotes}
            onChange={(e) => setCoupleNotes(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background"
            placeholder="Anything you want to remember…"
          />
        </Field>
        <ModalFooter onClose={onClose} busy={busy} submitLabel="Add vendor" />
      </form>
    </ModalShell>
  );
}

/* -------- Edit (couple-only fields on the link) -------- */

function EditLinkModal({
  row, onClose, onSaved,
}: { row: Row; onClose: () => void; onSaved: () => void }) {
  const [roleLabel, setRoleLabel] = useState(row.role_label ?? "");
  const [coupleNotes, setCoupleNotes] = useState(row.couple_notes ?? "");
  const [poc, setPoc] = useState(row.point_of_contact ?? "");
  const [pocPhone, setPocPhone] = useState(row.point_of_contact_phone ?? "");
  const [pocEmail, setPocEmail] = useState(row.point_of_contact_email ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase
      .from("wedding_vendors")
      .update({
        role_label: roleLabel.trim() || null,
        couple_notes: coupleNotes.trim() || null,
        point_of_contact: poc.trim() || null,
        point_of_contact_phone: pocPhone.trim() || null,
        point_of_contact_email: pocEmail.trim() || null,
      })
      .eq("id", row.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Saved");
    onSaved();
  };

  return (
    <ModalShell title={`Edit ${row.vendor.name}`} onClose={onClose}>
      <p className="text-xs text-muted-foreground mb-4">
        Your notes and point of contact for this vendor. Vendor details (name, website) are managed by the studio — reach out if anything needs to change.
      </p>
      <form onSubmit={submit} className="space-y-4">
        <Field label="What are they doing for you?">
          <Input value={roleLabel} onChange={setRoleLabel} placeholder="e.g. Day-of coordinator" />
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Your point of contact"><Input value={poc} onChange={setPoc} /></Field>
          <Field label="POC phone"><Input value={pocPhone} onChange={setPocPhone} /></Field>
          <Field label="POC email"><Input value={pocEmail} onChange={setPocEmail} type="email" /></Field>
        </div>
        <Field label="Notes (private to you)">
          <textarea
            value={coupleNotes}
            onChange={(e) => setCoupleNotes(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background"
          />
        </Field>
        <ModalFooter onClose={onClose} busy={busy} submitLabel="Save changes" />
      </form>
    </ModalShell>
  );
}

/* -------- tiny presentational helpers -------- */

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-foreground/40 flex items-start md:items-center justify-center p-4 overflow-y-auto">
      <div className="bg-surface rounded-lg shadow-elevated w-full max-w-xl border-t-2 border-gold my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="font-serif italic text-xl text-primary">{title}</h3>
          <button onClick={onClose} className="text-primary/60 hover:text-primary" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

function ModalFooter({ onClose, busy, submitLabel }: { onClose: () => void; busy: boolean; submitLabel: string }) {
  return (
    <div className="flex items-center justify-end gap-2 pt-2">
      <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-muted-foreground hover:text-primary">
        Cancel
      </button>
      <button
        type="submit"
        disabled={busy}
        className="bg-primary text-background px-4 py-2 rounded-md text-sm hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Saving…" : submitLabel}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">{label}</span>
      {children}
    </label>
  );
}

function Input({
  value, onChange, placeholder, type = "text", required = false,
}: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string; required?: boolean }) {
  return (
    <input
      type={type}
      value={value}
      required={required}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background"
    />
  );
}
