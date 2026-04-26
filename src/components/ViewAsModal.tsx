import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useViewAs } from "@/lib/view-as";
import type { AppRole } from "@/lib/auth";

export function ViewAsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { setViewAs } = useViewAs();
  const [profiles, setProfiles] = useState<{ id: string; full_name: string | null; role: AppRole }[]>([]);

  useEffect(() => {
    if (!open) return;
    supabase
      .from("profiles")
      .select("id, full_name, role")
      .in("role", ["studio_manager", "associate_photographer"])
      .order("full_name")
      .then(({ data }) => setProfiles((data ?? []) as never));
  }, [open]);

  if (!open) return null;

  const select = (p: { id: string; full_name: string | null; role: AppRole }) => {
    setViewAs({ id: p.id, full_name: p.full_name, role: p.role });
    onClose();
    // Soft refresh so all queries re-scope.
    setTimeout(() => window.location.reload(), 50);
  };

  return (
    <div className="fixed inset-0 z-50 bg-foreground/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background rounded-lg shadow-elevated w-full max-w-[420px] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="font-serif italic text-2xl text-primary">View as team member</h2>
            <p className="text-xs text-muted-foreground mt-1">See the studio through their eyes.</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-primary"><X size={18} /></button>
        </div>
        <ul className="divide-y divide-border">
          {profiles.length === 0 && (
            <li className="py-6 text-sm text-muted-foreground text-center font-serif italic">No team members to impersonate.</li>
          )}
          {profiles.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => select(p)}
                className="w-full flex items-center gap-3 py-3 hover:bg-background-alt/50 px-2 rounded-sm transition-colors text-left"
              >
                <span className="h-8 w-8 rounded-full bg-plum text-background flex items-center justify-center text-xs">
                  {(p.full_name ?? "?").charAt(0).toUpperCase()}
                </span>
                <div className="flex-1">
                  <p className="text-sm text-foreground">{p.full_name ?? "—"}</p>
                  <p className="text-[11px] text-muted-foreground capitalize">{p.role.replace(/_/g, " ")}</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
