import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PackageEditorModal, type PackageRow } from "@/components/studio/PackageEditorModal";
import { useIsOwner } from "@/lib/auth";

export const Route = createFileRoute("/studio/settings/packages")({
  component: PackagesPage,
});

function PackagesPage() {
  const isOwner = useIsOwner();
  const [rows, setRows] = useState<PackageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PackageRow | null>(null);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("packages")
      .select("id,name,description,base_price,default_hours,is_active,add_processing_fees,default_payment_schedule_template_id")
      .order("display_order", { ascending: true })
      .order("name");
    setRows((data ?? []) as PackageRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-serif text-3xl" style={{ color: "var(--sbv-green)" }}>Packages</h1>
        {isOwner && (
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-sm text-sm font-medium text-white"
            style={{ background: "var(--sbv-green)" }}
          >
            <Plus size={16} /> New package
          </button>
        )}
      </div>

      {!isOwner && (
        <p className="text-xs mb-4 italic" style={{ color: "var(--sbv-purple)" }}>
          Read-only — only owners can edit packages.
        </p>
      )}

      {loading ? (
        <p className="text-sm opacity-70">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm opacity-70">No packages yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((p) => {
            const meta = (
              <div>
                <div className="font-serif text-base" style={{ color: "var(--sbv-green)" }}>{p.name}</div>
                <div className="text-xs mt-0.5" style={{ color: "var(--sbv-purple)" }}>
                  {p.base_price != null ? `$${Number(p.base_price).toLocaleString()}` : "No price"}
                  {p.add_processing_fees ? " · fees baked in" : ""}
                  {!p.is_active ? " · inactive" : ""}
                </div>
              </div>
            );
            return isOwner ? (
              <button
                key={p.id}
                onClick={() => setEditing(p)}
                className="w-full text-left rounded-sm px-4 py-3 flex items-center justify-between hover:opacity-90 transition-opacity"
                style={{ background: "var(--sbv-pink-soft)" }}
              >
                {meta}
              </button>
            ) : (
              <div
                key={p.id}
                className="w-full rounded-sm px-4 py-3 flex items-center justify-between"
                style={{ background: "var(--sbv-pink-soft)" }}
              >
                {meta}
              </div>
            );
          })}
        </div>
      )}

      {isOwner && (
        <>
          <PackageEditorModal open={creating} pkg={null} onClose={() => setCreating(false)} onSaved={load} />
          <PackageEditorModal open={!!editing} pkg={editing} onClose={() => setEditing(null)} onSaved={load} />
        </>
      )}
    </div>
  );
}

