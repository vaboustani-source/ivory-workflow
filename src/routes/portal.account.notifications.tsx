import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/portal/account/notifications")({
  component: NotificationsSection,
});

function NotificationsSection() {
  const { profile } = useAuth();
  const [prefs, setPrefs] = useState({ messages: true, milestones: true, email: true });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rowId, setRowId] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    (async () => {
      const { data } = await supabase
        .from("client_users")
        .select("id, notification_messages_enabled, notification_milestones_enabled, notification_email_enabled")
        .eq("user_id", profile.id)
        .limit(1)
        .maybeSingle();
      if (data) {
        setRowId(data.id);
        setPrefs({
          messages: data.notification_messages_enabled,
          milestones: data.notification_milestones_enabled,
          email: data.notification_email_enabled,
        });
      }
      setLoaded(true);
    })();
  }, [profile?.id]);

  const save = async () => {
    if (!rowId) return;
    setSaving(true);
    const { error } = await supabase.from("client_users").update({
      notification_messages_enabled: prefs.messages,
      notification_milestones_enabled: prefs.milestones,
      notification_email_enabled: prefs.email,
    }).eq("id", rowId);
    if (error) toast.error(error.message); else toast.success("Saved.");
    setSaving(false);
  };

  return (
    <div>
      <h1 className="font-serif italic text-[24px] text-primary mb-6">Notifications</h1>
      <div className="bg-surface rounded-lg shadow-soft p-6 border-t-2 border-gold space-y-4">
        {!loaded ? <p className="text-sm text-muted-foreground italic">Loading…</p> : (
          <>
            <Toggle label="Email me when I get a new message" checked={prefs.messages} onChange={(v) => setPrefs((p) => ({ ...p, messages: v }))} />
            <Toggle label="Email me when a milestone is updated" checked={prefs.milestones} onChange={(v) => setPrefs((p) => ({ ...p, milestones: v }))} />
            <Toggle label="Email me reminders about pending tasks" checked={prefs.email} onChange={(v) => setPrefs((p) => ({ ...p, email: v }))} />
            <div className="pt-2">
              <button onClick={save} disabled={saving} className="bg-primary text-primary-foreground px-5 py-2 rounded-md text-sm hover:bg-primary/90 disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-4 py-2 border-b border-border last:border-0 cursor-pointer">
      <span className="text-sm text-foreground">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${checked ? "bg-primary" : "bg-border"}`}
        aria-pressed={checked}
      >
        <span className={`inline-block h-5 w-5 transform rounded-full bg-background transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
      </button>
    </label>
  );
}
