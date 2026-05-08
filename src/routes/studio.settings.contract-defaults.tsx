import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/studio/settings/contract-defaults")({
  component: ContractDefaultsPage,
});

interface Settings {
  id: string;
  overage_hourly_rate: number | null;
  video_cancellation_fee: number | null;
  album_credit_expiry_months: number | null;
  rescheduling_fee_pct: number | null;
  default_editing_rate: number | null;
}

type FieldKey = "overage_hourly_rate" | "video_cancellation_fee" | "album_credit_expiry_months" | "rescheduling_fee_pct" | "default_editing_rate";

function ContractDefaultsPage() {
  const [row, setRow] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("studio_settings")
        .select("id, overage_hourly_rate, video_cancellation_fee, album_credit_expiry_months, rescheduling_fee_pct, default_editing_rate")
        .eq("is_active", true)
        .maybeSingle();
      setRow(data as any);
      setLoading(false);
    })();
  }, []);

  const save = async (key: FieldKey, value: string) => {
    if (!row) return;
    const num = value.trim() === "" ? null : Number(value);
    if (num != null && Number.isNaN(num)) { toast.error("Must be a number"); return; }
    if ((row[key] ?? null) === (num ?? null)) return;
    const prev = row[key];
    setRow({ ...row, [key]: num } as Settings);
    const { error } = await supabase.from("studio_settings").update({ [key]: num } as any).eq("id", row.id);
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
        <h1 className="font-serif italic text-2xl text-primary">Contract defaults</h1>
        <p className="text-sm text-muted-foreground mt-1">Default fees and policies that flow into contracts via placeholders.</p>
      </div>

      <section className="space-y-5">
        <NumField
          label="Overage hourly rate"
          prefix="$"
          defaultValue={row.overage_hourly_rate}
          helper="What you charge per hour for coverage beyond the booked window. Used as {overage_hourly_rate} placeholder."
          onSave={(v) => save("overage_hourly_rate", v)}
        />
        <NumField
          label="Video cancellation fee"
          prefix="$"
          defaultValue={row.video_cancellation_fee}
          helper="Penalty for canceling videography after 24 hours. Used as {video_cancellation_fee} placeholder."
          onSave={(v) => save("video_cancellation_fee", v)}
        />
        <NumField
          label="Album credit expiry"
          suffix="months"
          defaultValue={row.album_credit_expiry_months}
          helper="How long album credits remain valid before expiry. Used as {album_credit_expiry_months} placeholder."
          onSave={(v) => save("album_credit_expiry_months", v)}
        />
        <NumField
          label="Rescheduling fee"
          suffix="%"
          defaultValue={row.rescheduling_fee_pct}
          helper="Percentage of total fee charged to reschedule a wedding. Used as {rescheduling_fee_pct} placeholder."
          onSave={(v) => save("rescheduling_fee_pct", v)}
        />
      </section>

      <section className="space-y-5">
        <div>
          <h2 className="font-serif italic text-xl text-primary">Editing</h2>
          <p className="text-sm text-muted-foreground mt-1">Used by Financials calculations.</p>
        </div>
        <NumField
          label="Default editing rate"
          prefix="$"
          suffix="/image"
          defaultValue={row.default_editing_rate}
          helper="Default rate applied to new clients. Existing clients keep their own rate."
          onSave={(v) => save("default_editing_rate", v)}
        />
      </section>
    </div>
  );
}

function NumField({ label, defaultValue, onSave, helper, prefix, suffix }: {
  label: string; defaultValue: number | null; onSave: (v: string) => void; helper?: string; prefix?: string; suffix?: string;
}) {
  const [val, setVal] = useState<string>(defaultValue != null ? String(defaultValue) : "");
  useEffect(() => { setVal(defaultValue != null ? String(defaultValue) : ""); }, [defaultValue]);
  return (
    <div>
      <label className="text-sm text-foreground block mb-1.5">{label}</label>
      <div className="flex items-stretch">
        {prefix && <span className="px-3 py-2 bg-background-alt border border-r-0 border-border rounded-l-md text-sm text-muted-foreground">{prefix}</span>}
        <input
          type="number"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={() => onSave(val)}
          className={`w-full px-3 py-2 bg-surface border border-border ${prefix && !suffix ? "rounded-r-md" : ""} ${suffix && !prefix ? "rounded-l-md" : ""} ${!prefix && !suffix ? "rounded-md" : ""} text-sm focus:outline-none focus:ring-2 focus:ring-primary/20`}
        />
        {suffix && <span className="px-3 py-2 bg-background-alt border border-l-0 border-border rounded-r-md text-sm text-muted-foreground">{suffix}</span>}
      </div>
      {helper && <p className="text-xs text-muted-foreground mt-1">{helper}</p>}
    </div>
  );
}
