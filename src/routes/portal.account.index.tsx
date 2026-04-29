import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/portal/account/")({
  component: ProfileSection,
});

function ProfileSection() {
  const { profile, refreshProfile } = useAuth();
  const [name, setName] = useState(profile?.full_name ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(profile?.full_name ?? "");
    setPhone(profile?.phone ?? "");
  }, [profile?.id]);

  const dirty = name !== (profile?.full_name ?? "") || phone !== (profile?.phone ?? "");

  const save = async () => {
    if (!profile) return;
    setSaving(true);
    const { error } = await supabase.from("profiles").update({ full_name: name, phone }).eq("id", profile.id);
    if (error) toast.error(error.message);
    else {
      await supabase.from("activity_log").insert({
        user_id: profile.id, action_type: "portal.profile_updated", target_type: "profile", target_id: profile.id, description: "Profile updated",
      });
      toast.success("Saved.");
      await refreshProfile();
    }
    setSaving(false);
  };

  return (
    <div>
      <h1 className="font-serif italic text-[24px] text-primary mb-6">Your profile</h1>
      <div className="bg-surface rounded-lg shadow-soft p-6 border-t-2 border-gold space-y-4">
        <Field label="Display name">
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full md:w-[280px] px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
        </Field>
        <Field label="Email" hint="To change your email, please reach out to us.">
          <input value={profile?.email ?? ""} disabled className="w-full md:w-[280px] px-3 py-2 bg-background-alt border border-border rounded-md text-sm text-muted-foreground" />
        </Field>
        <Field label="Phone">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full md:w-[280px] px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
        </Field>
        <div className="pt-2">
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="bg-primary text-primary-foreground px-5 py-2 rounded-md text-sm hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] uppercase tracking-wider text-muted-foreground block mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground mt-1 italic">{hint}</p>}
    </div>
  );
}
