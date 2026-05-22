import { useEffect, useState, useCallback } from "react";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { TemplateEditorModal, type TemplateRecord } from "./TemplateEditorModal";
import { useIsOwner } from "@/lib/auth";

interface PackageOption { id: string; name: string }

interface TemplateRow extends TemplateRecord {
  package_name: string | null;
  installment_count: number;
}

export function TemplatesTab() {
  const isOwner = useIsOwner();
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [packages, setPackages] = useState<PackageOption[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editTemplate, setEditTemplate] = useState<TemplateRecord | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: tpls }, { data: pkgs }, { data: insts }] = await Promise.all([
      supabase
        .from("payment_schedule_templates")
        .select("id,name,package_id,is_active,created_at")
        .order("created_at", { ascending: false }),
      supabase.from("packages").select("id,name").order("display_order", { ascending: true }),
      supabase.from("payment_schedule_template_installments").select("template_id"),
    ]);
    const pkgMap = new Map<string, string>();
    (pkgs ?? []).forEach((p: any) => pkgMap.set(p.id, p.name));
    const counts = new Map<string, number>();
    (insts ?? []).forEach((i: any) => counts.set(i.template_id, (counts.get(i.template_id) ?? 0) + 1));
    setPackages((pkgs ?? []).map((p: any) => ({ id: p.id, name: p.name })));
    setRows(
      (tpls ?? []).map((t: any) => ({
        id: t.id,
        name: t.name,
        package_id: t.package_id,
        is_active: t.is_active,
        package_name: t.package_id ? pkgMap.get(t.package_id) ?? null : null,
        installment_count: counts.get(t.id) ?? 0,
      }))
    );
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = rows.filter((r) => (showInactive ? true : r.is_active));

  const openNew = () => { setEditTemplate(null); setEditorOpen(true); };
  const openEdit = (r: TemplateRow) => { setEditTemplate({ id: r.id, name: r.name, package_id: r.package_id, is_active: r.is_active }); setEditorOpen(true); };

  return (
    <div>
      {visible.length === 0 && !loading ? (
        <div className="py-24 text-center">
          <h2 className="font-serif text-3xl mb-2" style={{ color: "var(--sbv-green)" }}>No templates yet.</h2>
          {isOwner ? (
            <>
              <p className="text-sm mb-6" style={{ color: "var(--sbv-purple)" }}>Create your first payment schedule.</p>
              <button
                onClick={openNew}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-sm text-sm font-medium text-white"
                style={{ background: "var(--sbv-green)" }}
              >
                <Plus size={16} />
                New template
              </button>
            </>
          ) : (
            <p className="text-sm italic" style={{ color: "var(--sbv-purple)" }}>Only owners can create templates.</p>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-4">
            <label className="inline-flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--sbv-purple)" }}>
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                className="accent-current"
              />
              Show inactive
            </label>
            {isOwner && (
              <button
                onClick={openNew}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-sm text-sm font-medium text-white"
                style={{ background: "var(--sbv-green)" }}
              >
                <Plus size={14} />
                New template
              </button>
            )}
          </div>

          <div className="rounded-md overflow-hidden" style={{ background: "var(--sbv-pink)" }}>
            <div className="grid grid-cols-[2fr_1.4fr_1fr_auto] px-5 py-3 text-[11px] uppercase tracking-[0.14em]" style={{ color: "var(--sbv-purple)" }}>
              <span>Template</span>
              <span>Package</span>
              <span>Installments</span>
              <span>Status</span>
            </div>
            <div className="divide-y" style={{ borderColor: "rgba(65,25,40,0.12)" }}>
              {visible.map((r) => {
                const cells = (
                  <>
                    <span className="font-serif text-lg" style={{ color: "var(--sbv-green)" }}>{r.name}</span>
                    <span className="text-sm" style={{ color: "var(--sbv-purple)" }}>
                      {r.package_name ?? <span className="italic opacity-70">Global</span>}
                    </span>
                    <span className="text-sm" style={{ color: "var(--sbv-purple)" }}>{r.installment_count}</span>
                    <span className="text-xs uppercase tracking-[0.14em]">
                      {r.is_active ? (
                        <span className="foil-gold font-semibold">Active</span>
                      ) : (
                        <span style={{ color: "var(--sbv-purple)", opacity: 0.55 }}>Inactive</span>
                      )}
                    </span>
                  </>
                );
                return isOwner ? (
                  <button
                    key={r.id}
                    onClick={() => openEdit(r)}
                    className="w-full grid grid-cols-[2fr_1.4fr_1fr_auto] items-center px-5 py-4 text-left transition-colors hover:bg-white/30"
                  >
                    {cells}
                  </button>
                ) : (
                  <div
                    key={r.id}
                    className="w-full grid grid-cols-[2fr_1.4fr_1fr_auto] items-center px-5 py-4"
                  >
                    {cells}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {isOwner && (
        <TemplateEditorModal
          open={editorOpen}
          onClose={() => setEditorOpen(false)}
          onSaved={load}
          template={editTemplate}
          packages={packages}
        />
      )}
    </div>
  );
}
