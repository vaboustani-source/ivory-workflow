import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { EMAIL_COPY_SCHEMAS } from "@/lib/email-copy-schemas";
import { toast } from "sonner";
import { Mail, RotateCcw } from "lucide-react";

export const Route = createFileRoute("/studio/settings/emails/$emailType")({
  component: EmailTemplateEditor,
});

function EmailTemplateEditor() {
  const { emailType } = Route.useParams();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const schema = EMAIL_COPY_SCHEMAS[emailType];

  const [values, setValues] = useState<Record<string, string>>({});
  const [savedValues, setSavedValues] = useState<Record<string, string>>({});
  const [previewHtml, setPreviewHtml] = useState<string>("");
  const [previewSubject, setPreviewSubject] = useState<string>("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [sendingPreview, setSendingPreview] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (profile && profile.role !== "owner") {
      navigate({ to: "/studio/settings/profile" });
    }
  }, [profile, navigate]);

  useEffect(() => {
    if (!schema) return;
    (async () => {
      const { data } = await supabase
        .from("email_template_copy")
        .select("copy")
        .eq("email_type", emailType)
        .maybeSingle();
      const copy = ((data?.copy as Record<string, string> | null) ?? {});
      setValues(copy);
      setSavedValues(copy);
    })();
  }, [emailType, schema]);

  // Debounced auto-save
  useEffect(() => {
    if (!schema) return;
    if (JSON.stringify(values) === JSON.stringify(savedValues)) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveStatus("saving");
    saveTimer.current = setTimeout(async () => {
      const { error } = await supabase
        .from("email_template_copy")
        .upsert({ email_type: emailType, copy: values, updated_by: profile?.id }, { onConflict: "email_type" });
      if (error) {
        toast.error(`Save failed: ${error.message}`);
        setSaveStatus("idle");
      } else {
        setSavedValues(values);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 1500);
      }
    }, 1000);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [values, savedValues, emailType, profile?.id, schema]);

  // Debounced live preview
  useEffect(() => {
    if (!schema) return;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(async () => {
      const { data, error } = await supabase.functions.invoke("render-email-preview", {
        body: { email_type: emailType, overrides_inline: values },
      });
      if (!error && data?.html) {
        setPreviewHtml(data.html);
        setPreviewSubject(data.subject ?? "");
      }
    }, 400);
    return () => { if (previewTimer.current) clearTimeout(previewTimer.current); };
  }, [values, emailType, schema]);

  const insertPlaceholder = (fieldKey: string, placeholder: string) => {
    const el = document.getElementById(`field-${fieldKey}`) as HTMLInputElement | HTMLTextAreaElement | null;
    const token = `{${placeholder}}`;
    const current = values[fieldKey] ?? schema.fields.find((f) => f.key === fieldKey)?.defaultValue ?? "";
    if (el && (el.selectionStart != null)) {
      const start = el.selectionStart ?? current.length;
      const end = el.selectionEnd ?? current.length;
      const next = current.slice(0, start) + token + current.slice(end);
      setValues((v) => ({ ...v, [fieldKey]: next }));
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + token.length;
        el.setSelectionRange(pos, pos);
      });
    } else {
      setValues((v) => ({ ...v, [fieldKey]: (current ?? "") + token }));
    }
  };

  const handleReset = async () => {
    if (!confirm("Reset all custom copy for this email type? This cannot be undone.")) return;
    const { error } = await supabase
      .from("email_template_copy")
      .update({ copy: {}, updated_by: profile?.id })
      .eq("email_type", emailType);
    if (error) { toast.error(error.message); return; }
    setValues({});
    setSavedValues({});
    toast.success("Reset to default copy");
  };

  const sendPreview = async () => {
    if (!profile?.email) { toast.error("No email on your profile."); return; }
    setSendingPreview(true);
    try {
      const { data, error } = await supabase.functions.invoke("preview-emails", {
        body: { recipient: profile.email, types: [emailType] },
      });
      if (error) throw error;
      const ok = (data?.results ?? []).some((r: { emailed: boolean }) => r.emailed);
      if (ok) toast.success(`Preview sent to ${profile.email}`);
      else toast.error("Send failed");
    } catch (e) { toast.error((e as Error).message); }
    finally { setSendingPreview(false); }
  };

  if (!schema) {
    return <p className="text-sm text-muted-foreground">Unknown email type.</p>;
  }

  return (
    <div>
      <nav className="text-xs text-muted-foreground mb-3">
        <Link to="/studio/settings/profile" className="hover:underline">Settings</Link>
        {" / "}
        <Link to="/studio/settings/emails" className="hover:underline">Email templates</Link>
        {" / "}
        <span>{schema.displayName}</span>
      </nav>

      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-serif italic text-[28px] text-burgundy">{schema.displayName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{schema.description}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved" : ""}
          </span>
          <button
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 text-xs text-magenta hover:underline"
          >
            <RotateCcw size={12} />
            Reset to default
          </button>
          <button
            onClick={sendPreview}
            disabled={sendingPreview}
            className="inline-flex items-center gap-2 border border-gold text-gold hover:bg-gold/10 rounded-md px-3 py-2 text-xs uppercase tracking-wider transition-colors disabled:opacity-50"
          >
            <Mail size={12} />
            {sendingPreview ? "Sending…" : "Send preview to me"}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* LEFT: form */}
        <div className="space-y-6">
          {schema.fields.map((field) => {
            const v = values[field.key] ?? "";
            const placeholder = field.defaultValue;
            return (
              <div key={field.key}>
                <label htmlFor={`field-${field.key}`} className="block text-sm font-medium text-foreground">
                  {field.label}
                </label>
                {field.helper && <p className="text-xs text-muted-foreground mt-0.5">{field.helper}</p>}
                {field.type === "long_text" ? (
                  <textarea
                    id={`field-${field.key}`}
                    value={v}
                    onChange={(e) => setValues((s) => ({ ...s, [field.key]: e.target.value }))}
                    placeholder={placeholder}
                    rows={4}
                    className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
                  />
                ) : (
                  <input
                    id={`field-${field.key}`}
                    value={v}
                    onChange={(e) => setValues((s) => ({ ...s, [field.key]: e.target.value }))}
                    placeholder={placeholder}
                    className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
                  />
                )}
                <p className="text-xs text-muted-foreground mt-1.5">
                  Default: <span className="italic">{truncate(field.defaultValue, 80)}</span>
                </p>
                {field.supportsPlaceholders && schema.availablePlaceholders.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {schema.availablePlaceholders.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => insertPlaceholder(field.key, p)}
                        className="border border-gold text-gold hover:bg-gold/10 rounded px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors"
                      >
                        {`{${p}}`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* RIGHT: live preview */}
        <div className="lg:sticky lg:top-6 self-start">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="font-serif italic text-lg text-burgundy">Preview</h2>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Updates as you type
            </span>
          </div>
          {previewSubject && (
            <p className="text-xs text-muted-foreground mb-2 truncate">
              <span className="uppercase tracking-wider mr-1">Subject:</span>
              {previewSubject}
            </p>
          )}
          <iframe
            title="Email preview"
            srcDoc={previewHtml}
            className="w-full rounded-md border border-border bg-white"
            style={{ minHeight: 600, height: "70vh" }}
            sandbox=""
          />
        </div>
      </div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n).trim() + "…" : s;
}
