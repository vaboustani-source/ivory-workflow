import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Download, FileText, AlertTriangle, Send } from "lucide-react";
import { shortDate } from "@/lib/dates";
import { sendContractorW9Request } from "@/lib/contractorW9.functions";

export const Route = createFileRoute("/studio/settings/contractors-tax")({
  component: ContractorsTaxPage,
});

const BUCKET = "contractor-tax-docs";

interface Row {
  contractor_id: string;
  full_name: string;
  email: string;
  legal_name: string | null;
  mailing_address: string | null;
  business_type: string | null;
  tax_id_type: string | null;
  tax_id_on_file: boolean;
  w9_collected: boolean;
  w9_collected_at: string | null;
  w9_requested_at: string | null;
  w9_file_path: string | null;
  w9_original_filename: string | null;
  total_cents: number;
}

const dollars = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

function ContractorsTaxPage() {
  const { roles } = useAuth();
  const allowed = roles.includes("owner") || roles.includes("studio_manager");

  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!allowed) return;
    setLoading(true);
    supabase
      .rpc("get_contractor_1099_report", { _tax_year: year })
      .then(({ data, error }) => {
        if (error) {
          toast.error(error.message);
          setRows([]);
        } else {
          setRows((data ?? []) as Row[]);
        }
        setLoading(false);
      });
  }, [year, allowed]);

  const missingW9 = useMemo(() => rows.filter((r) => !r.w9_collected).length, [rows]);

  const yearOptions = useMemo(() => {
    const years: number[] = [];
    for (let y = currentYear + 1; y >= currentYear - 5; y--) years.push(y);
    return years;
  }, [currentYear]);

  const download = async (r: Row) => {
    if (!r.w9_file_path) return;
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(r.w9_file_path, 60);
    if (error || !data?.signedUrl) {
      toast.error(error?.message ?? "Could not generate download link");
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  const exportCsv = () => {
    const header = [
      "contractor_name",
      "legal_name",
      "mailing_address",
      "business_type",
      "total_paid_usd",
      "tax_id_type",
      "tax_id_on_file",
      "w9_status",
      "w9_collected_at",
    ];
    const escape = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.full_name,
          r.legal_name ?? "",
          r.mailing_address ?? "",
          r.business_type ?? "",
          (r.total_cents / 100).toFixed(2),
          r.tax_id_type ?? "",
          r.tax_id_on_file ? "yes" : "no",
          r.w9_collected ? "on_file" : r.w9_requested_at ? "requested" : "not_on_file",
          r.w9_collected_at ?? "",
        ]
          .map(escape)
          .join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `1099-report-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!allowed) {
    return (
      <div className="bg-surface border-t-2 border-gold rounded-lg shadow-soft p-8">
        <p className="font-serif italic text-primary text-lg">
          You don't have access to the 1099 / Taxes report.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="font-serif italic text-[28px] text-primary leading-tight">
            1099 / Taxes
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Contractors who crossed the $600 threshold for the calendar year.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs uppercase tracking-wider text-muted-foreground">Year</label>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="px-3 py-2 bg-background border border-border rounded-md text-sm"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <button
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-3 py-2 rounded-md text-sm hover:bg-primary/90 disabled:opacity-40"
          >
            <Download size={14} /> Export CSV
          </button>
        </div>
      </header>

      {!loading && rows.length > 0 && (
        <div className="bg-surface border-t-2 border-gold rounded-lg shadow-soft p-4 text-sm text-primary">
          <strong>{rows.length}</strong> contractor{rows.length === 1 ? "" : "s"} need a 1099 this year ·{" "}
          <strong>{missingW9}</strong> still missing a W-9.
        </div>
      )}

      {loading ? (
        <p className="font-serif italic text-primary p-8">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="bg-surface rounded-lg shadow-soft py-20 text-center border-t-2 border-gold">
          <p className="font-serif italic text-2xl text-primary">
            No one has crossed the $600 1099 threshold for {year} yet.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            They'll appear here automatically once wedding crew assignments add up.
          </p>
        </div>
      ) : (
        <div className="bg-surface rounded-lg shadow-soft border-t-2 border-gold overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-background-alt text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Contractor</th>
                <th className="text-left px-4 py-3">Mailing / business type</th>
                <th className="text-right px-4 py-3">Total paid</th>
                <th className="text-left px-4 py-3">W-9 status</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const status = r.w9_collected
                  ? "on_file"
                  : r.w9_requested_at
                    ? "requested"
                    : "missing";
                return (
                  <tr key={r.contractor_id} className="border-t border-border align-top">
                    <td className="px-4 py-3">
                      <Link
                        to="/studio/settings/contractors"
                        className="font-serif italic text-primary hover:underline"
                      >
                        {r.full_name}
                      </Link>
                      {r.legal_name && (
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          Legal: {r.legal_name}
                        </div>
                      )}
                      <div className="text-[11px] text-muted-foreground">{r.email}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground max-w-[260px]">
                      <div>{r.mailing_address ?? <em className="text-amber-700">No address on file</em>}</div>
                      <div className="mt-1">{r.business_type ?? "—"}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-primary">
                      {dollars(r.total_cents)}
                    </td>
                    <td className="px-4 py-3">
                      {status === "on_file" && (
                        <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider bg-emerald-100 text-emerald-800 px-2 py-1 rounded-sm">
                          <FileText size={11} /> On file
                          {r.w9_collected_at && (
                            <span className="ml-1 normal-case tracking-normal text-emerald-700/80">
                              · {shortDate(r.w9_collected_at)}
                            </span>
                          )}
                        </span>
                      )}
                      {status === "requested" && (
                        <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider bg-amber-100 text-amber-800 px-2 py-1 rounded-sm">
                          Requested
                          {r.w9_requested_at && (
                            <span className="ml-1 normal-case tracking-normal text-amber-700/80">
                              · {shortDate(r.w9_requested_at)}
                            </span>
                          )}
                        </span>
                      )}
                      {status === "missing" && (
                        <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider bg-rose-100 text-rose-800 px-2 py-1 rounded-sm">
                          <AlertTriangle size={11} /> Not on file
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        {r.w9_collected && r.w9_file_path && (
                          <button
                            onClick={() => download(r)}
                            className="text-xs border border-gold text-gold px-3 py-1.5 rounded-md hover:bg-gold/10 inline-flex items-center gap-1"
                          >
                            <Download size={12} /> W-9
                          </button>
                        )}
                        <Link
                          to="/studio/settings/contractors"
                          className="text-xs border border-border text-muted-foreground px-3 py-1.5 rounded-md hover:text-primary"
                        >
                          Open
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
