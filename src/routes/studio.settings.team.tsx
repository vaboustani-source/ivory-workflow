import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { relativeTime } from "@/lib/dates";

export const Route = createFileRoute("/studio/settings/team")({
  component: TeamPage,
});

interface TeamMember {
  id: string;
  email: string | null;
  full_name: string | null;
  role: "owner" | "studio_manager" | "associate_photographer" | "client";
  created_at: string;
}

function TeamPage() {
  const { profile } = useAuth();
  const isOwner = profile?.role === "owner";
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [modalOpen, setModalOpen] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("profiles")
      .select("id, email, full_name, role, created_at")
      .in("role", ["owner", "studio_manager", "associate_photographer"])
      .order("role");
    setMembers((data ?? []) as TeamMember[]);
  };

  useEffect(() => { load(); }, []);

  const updateRole = async (id: string, role: TeamMember["role"]) => {
    const { error } = await supabase.from("profiles").update({ role }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Role updated.");
    load();
  };

  return (
    <div>
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="font-serif italic text-[28px] text-primary">Team</h1>
          <p className="text-sm text-muted-foreground mt-1">The people behind every story.</p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="bg-primary text-primary-foreground rounded-md px-4 py-2.5 text-sm font-medium hover:bg-primary/90 flex items-center gap-2"
        >
          <Plus size={16} /> Invite team member
        </button>
      </div>

      <div className="bg-surface rounded-lg shadow-soft p-6">
        <table className="w-full">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="py-3 font-medium">Person</th>
              <th className="py-3 font-medium">Role</th>
              <th className="py-3 font-medium">Status</th>
              <th className="py-3 font-medium">Last active</th>
              {isOwner && <th className="py-3 font-medium w-20"></th>}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b border-border last:border-0">
                <td className="py-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-plum text-background flex items-center justify-center text-sm">
                      {m.full_name?.[0]?.toUpperCase() ?? "?"}
                    </div>
                    <div>
                      <p className="font-serif italic text-base text-primary">{m.full_name ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">{m.email}</p>
                    </div>
                  </div>
                </td>
                <td className="py-4">
                  {isOwner && m.id !== profile?.id ? (
                    <select
                      value={m.role}
                      onChange={(e) => updateRole(m.id, e.target.value as TeamMember["role"])}
                      className="bg-surface border border-border rounded-sm px-2 py-1 text-sm capitalize"
                    >
                      <option value="owner">owner</option>
                      <option value="studio_manager">studio_manager</option>
                      <option value="associate_photographer">associate_photographer</option>
                    </select>
                  ) : (
                    <span className="text-sm text-foreground capitalize">{m.role.replace(/_/g, " ")}</span>
                  )}
                </td>
                <td className="py-4">
                  <span className="text-sm flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-sage" /> Active
                  </span>
                </td>
                <td className="py-4 text-sm text-muted-foreground">{relativeTime(m.created_at)}</td>
                {isOwner && (
                  <td className="py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button className="text-muted-foreground hover:text-primary"><Pencil size={14} /></button>
                      <button className="text-muted-foreground hover:text-destructive"><Trash2 size={14} /></button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <InviteModal open={modalOpen} onClose={() => setModalOpen(false)} onInvited={load} />
    </div>
  );
}

function InviteModal({ open, onClose, onInvited }: { open: boolean; onClose: () => void; onInvited: () => void }) {
  const { profile } = useAuth();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"studio_manager" | "associate_photographer">("studio_manager");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { data: { role, full_name: email.split("@")[0] }, emailRedirectTo: window.location.origin },
    });
    setSubmitting(false);
    if (error) return toast.error(error.message);
    await supabase.from("activity_log").insert({
      user_id: profile?.id,
      action_type: "team.invited",
      target_type: "user",
      description: `Invited ${email} as ${role}`,
      metadata: { email, role, message },
    });
    toast.success("Invitation sent.");
    setEmail(""); setMessage("");
    onInvited();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-foreground/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background rounded-lg shadow-elevated w-full max-w-[480px] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-6">
          <h2 className="font-serif italic text-2xl text-primary">Invite a team member</h2>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Email *</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value as typeof role)} className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-sm">
              <option value="studio_manager">studio_manager</option>
              <option value="associate_photographer">associate_photographer</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Welcome message</label>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="text-sm text-muted-foreground hover:text-primary px-3 py-2">Cancel</button>
            <button type="submit" disabled={submitting} className="bg-primary text-primary-foreground rounded-md px-5 py-2.5 text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
              {submitting ? "Sending…" : "Send invitation"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
