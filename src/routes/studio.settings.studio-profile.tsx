import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/studio/settings/studio-profile")({
  component: StudioProfilePage,
});

interface Settings {
  id: string;
  photographer_name: string | null;
  photographer_company: string | null;
  studio_email: string | null;
  studio_phone: string | null;
  website: string | null;
  instagram: string | null;
  studio_address: string | null;
  studio_mailing_address: string | null;
  ein: string | null;
}

type FieldKey = keyof Omit<Settings, "id">;

function StudioProfilePage() {
  const [row, setRow] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("studio_settings")
        .select("id, photographer_name, photographer_company, studio_email, studio_phone, website, instagram, studio_address, studio_mailing_address, ein")
        .eq("is_active", true)
        .maybeSingle();
      setRow(data as any);
      setLoading(false);
    })();
  }, []);

  const save = async (key: FieldKey, value: string) => {
    if (!row) return;
    const trimmed = value.trim() === "" ? null : value;
    if ((row[key] ?? null) === (trimmed ?? null)) return;
    const prev = row[key];
    setRow({ ...row, [key]: trimmed } as Settings);
    const { error } = await supabase.from("studio_settings").update({ [key]: trimmed }).eq("id", row.id);
    if (error) {
      setRow({ ...row, [key]: prev } as Settings);
      toast.error(error.message);
    } else {
      toast.success("Saved");
    }
  };

  if (loading) return <p className="font-serif italic text-primary">Loading…</p>;
  if (!row) return <p className="text-sm text-muted-foreground">No studio settings found.</p>;

  return (
    <div className="max-w-2xl space-y-10">
      <div>
        <h1 className="font-serif italic text-2xl text-primary">Studio profile</h1>
        <p className="text-sm text-muted-foreground mt-1">Your business identity — used across contracts, marketing materials, and client communications.</p>
      </div>

      <Section title="Identity">
        <TextField label="Photographer name" defaultValue={row.photographer_name ?? ""} onSave={(v) => save("photographer_name", v)} />
        <TextField label="Studio company name" defaultValue={row.photographer_company ?? ""} onSave={(v) => save("photographer_company", v)} />
        <TextField label="Studio email" type="email" defaultValue={row.studio_email ?? ""} onSave={(v) => save("studio_email", v)} />
        <TextField label="Studio phone" defaultValue={row.studio_phone ?? ""} onSave={(v) => save("studio_phone", v)} />
      </Section>

      <Section title="Online presence">
        <TextField label="Website URL" type="url" placeholder="https://..." defaultValue={row.website ?? ""} onSave={(v) => save("website", v)} />
        <TextField
          label="Instagram handle"
          defaultValue={row.instagram ?? ""}
          prefix="@"
          onSave={(v) => save("instagram", v.replace(/^@+/, ""))}
        />
      </Section>

      <Section title="Business">
        <TextAreaField label="Physical address" defaultValue={row.studio_address ?? ""} onSave={(v) => save("studio_address", v)} />
        <TextAreaField label="Mailing address" helper="If different from physical" defaultValue={row.studio_mailing_address ?? ""} onSave={(v) => save("studio_mailing_address", v)} />
        <TextField label="EIN / Tax ID" helper="9-digit federal tax ID" defaultValue={row.ein ?? ""} onSave={(v) => save("ein", v)} />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function TextField({ label, defaultValue, onSave, helper, type = "text", placeholder, prefix }: {
  label: string; defaultValue: string; onSave: (v: string) => void; helper?: string; type?: string; placeholder?: string; prefix?: string;
}) {
  const [val, setVal] = useState(defaultValue);
  useEffect(() => { setVal(defaultValue); }, [defaultValue]);
  return (
    <div>
      <label className="text-sm text-foreground block mb-1.5">{label}</label>
      <div className="flex items-stretch">
        {prefix && <span className="px-3 py-2 bg-background-alt border border-r-0 border-border rounded-l-md text-sm text-muted-foreground">{prefix}</span>}
        <input
          type={type}
          value={val}
          placeholder={placeholder}
          onChange={(e) => setVal(e.target.value)}
          onBlur={() => onSave(val)}
          className={`w-full px-3 py-2 bg-surface border border-border ${prefix ? "rounded-r-md" : "rounded-md"} text-sm focus:outline-none focus:ring-2 focus:ring-primary/20`}
        />
      </div>
      {helper && <p className="text-xs text-muted-foreground mt-1">{helper}</p>}
    </div>
  );
}

function TextAreaField({ label, defaultValue, onSave, helper }: {
  label: string; defaultValue: string; onSave: (v: string) => void; helper?: string;
}) {
  const [val, setVal] = useState(defaultValue);
  useEffect(() => { setVal(defaultValue); }, [defaultValue]);
  return (
    <div>
      <label className="text-sm text-foreground block mb-1.5">{label}</label>
      <textarea
        value={val}
        rows={3}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => onSave(val)}
        className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-y"
      />
      {helper && <p className="text-xs text-muted-foreground mt-1">{helper}</p>}
    </div>
  );
}
