import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { EMAIL_COPY_SCHEMAS, EMAIL_TYPE_ORDER } from "@/lib/email-copy-schemas";
import { relativeTime } from "@/lib/dates";

export const Route = createFileRoute("/studio/settings/emails/")({
  component: EmailTemplatesList,
});

interface CopyRow { email_type: string; copy: Record<string, string>; updated_at: string | null; }

function EmailTemplatesList() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<CopyRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (profile && profile.role !== "owner") {
      navigate({ to: "/studio/settings/profile" });
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("email_template_copy")
        .select("email_type, copy, updated_at");
      setRows((data ?? []) as CopyRow[]);
      setLoading(false);
    })();
  }, [profile, navigate]);

  if (profile && profile.role !== "owner") return null;

  const byType = new Map(rows.map((r) => [r.email_type, r]));

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-serif italic text-[28px] text-burgundy">Email templates</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Customize the copy of every email the platform sends. Brand styling stays the same.
        </p>
      </header>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {EMAIL_TYPE_ORDER.map((type) => {
            const schema = EMAIL_COPY_SCHEMAS[type];
            const row = byType.get(type);
            const hasOverrides = row && row.copy && Object.values(row.copy).some((v) => v && String(v).trim() !== "");
            return (
              <Link
                key={type}
                to="/studio/settings/emails/$emailType"
                params={{ emailType: type }}
                className="block bg-surface rounded-lg shadow-soft p-6 border-t-2 border-gold hover:shadow-elevated transition-shadow"
              >
                <h2 className="font-serif italic text-xl text-burgundy">{schema.displayName}</h2>
                <p className="mt-2 text-sm text-foreground/80 leading-relaxed">{schema.description}</p>
                <div className="mt-5 flex items-center justify-between">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {hasOverrides ? `Last updated ${relativeTime(row!.updated_at)}` : "Using defaults"}
                  </p>
                  <span className="inline-flex items-center border border-gold text-gold rounded-md px-3 py-1.5 text-xs uppercase tracking-wider">
                    Edit
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
