import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { relativeTime } from "@/lib/dates";
import { Search, X, Download, Trash2, FileText, Image as ImageIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/studio/settings/storage")({
  component: StoragePage,
});

interface AttRow {
  id: string;
  message_id: string;
  file_name: string;
  storage_path: string;
  file_size_bytes: number | null;
  mime_type: string | null;
  thumbnail_url: string | null;
  file_url: string | null;
  created_at: string;
  uploaded_by: string | null;
}

interface ConvJoin {
  conversation_id: string;
  client_id: string;
  client: { id: string; couple_name_1: string; couple_name_2: string | null; status: string } | null;
}

interface CoupleRow {
  client_id: string;
  couple_name_1: string;
  couple_name_2: string | null;
  status: string;
  conversation_id: string;
  files: number;
  bytes: number;
  last_attachment_at: string | null;
}

function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function StoragePage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [couples, setCouples] = useState<CoupleRow[]>([]);
  const [totals, setTotals] = useState({ bytes: 0, files: 0, archived: 0, pending: 0 });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "archived">("all");
  const [drillCouple, setDrillCouple] = useState<CoupleRow | null>(null);

  useEffect(() => {
    if (profile && profile.role !== "owner") navigate({ to: "/studio/settings/profile" });
  }, [profile, navigate]);

  const load = async () => {
    setLoading(true);
    // 1) attachments + linked conversation/client (via messages -> conversations -> clients)
    const { data: atts } = await supabase
      .from("message_attachments")
      .select("id, file_size_bytes, created_at, message_id, message:messages!message_attachments_message_id_fkey(conversation_id, conversation:conversations(client_id, client:clients(id, couple_name_1, couple_name_2, status)))")
      .order("created_at", { ascending: false });

    const map = new Map<string, CoupleRow>();
    let totalFiles = 0;
    let totalBytes = 0;
    (atts ?? []).forEach((a: any) => {
      const conv = a.message?.conversation;
      const client = conv?.client;
      if (!client) return;
      const key = client.id;
      const existing = map.get(key);
      const bytes = a.file_size_bytes ?? 0;
      totalFiles += 1;
      totalBytes += bytes;
      if (existing) {
        existing.files += 1;
        existing.bytes += bytes;
        if (!existing.last_attachment_at || a.created_at > existing.last_attachment_at) {
          existing.last_attachment_at = a.created_at;
        }
      } else {
        map.set(key, {
          client_id: client.id,
          couple_name_1: client.couple_name_1,
          couple_name_2: client.couple_name_2,
          status: client.status,
          conversation_id: conv.id ?? a.message.conversation_id,
          files: 1,
          bytes,
          last_attachment_at: a.created_at,
        });
      }
    });

    const arr = Array.from(map.values()).sort((x, y) => y.bytes - x.bytes);

    // 2) archived couples
    const { count: archivedCount } = await supabase
      .from("clients")
      .select("id", { count: "exact", head: true })
      .eq("status", "archived");

    // 3) pending cleanup queue
    const { count: pendingCount } = await supabase
      .from("storage_cleanup_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");

    setCouples(arr);
    setTotals({ bytes: totalBytes, files: totalFiles, archived: archivedCount ?? 0, pending: pendingCount ?? 0 });
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = couples.filter((c) => {
    if (filter === "archived" && c.status !== "archived") return false;
    if (search) {
      const hay = `${c.couple_name_1} ${c.couple_name_2 ?? ""}`.toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  const coupleName = (c: CoupleRow) =>
    `${c.couple_name_1}${c.couple_name_2 ? " & " + c.couple_name_2 : ""}`;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif italic text-[28px] text-primary">Storage</h1>
        <p className="text-sm text-muted-foreground mt-1">Files attached in messages, organized by couple.</p>
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard label="Total used" value={fmtBytes(totals.bytes)} />
        <KpiCard label="Total files" value={totals.files.toLocaleString()} />
        <KpiCard label="Archived couples" value={totals.archived.toLocaleString()} />
        <KpiCard label="Pending cleanup" value={totals.pending.toLocaleString()} />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search couples…"
            className="w-full pl-8 pr-2 py-1.5 bg-surface border border-primary/15 rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        {(["all", "archived"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded-full text-[11px] uppercase tracking-wider transition-colors ${
              filter === f ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground hover:text-primary"
            }`}
          >
            {f === "all" ? "All" : "Archived"}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-surface rounded-md border border-primary/15 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-background-alt text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Couple</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-right px-4 py-3 font-medium">Files</th>
              <th className="text-right px-4 py-3 font-medium">Storage</th>
              <th className="text-left px-4 py-3 font-medium">Last attachment</th>
              <th className="text-right px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="font-serif italic text-primary p-6 text-center">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="font-serif italic text-muted-foreground p-6 text-center">No attachments yet.</td></tr>
            ) : filtered.map((c) => (
              <tr key={c.client_id} className="border-t border-border/40 hover:bg-background-alt/50">
                <td className="px-4 py-3">
                  <Link to="/studio/clients/$id" params={{ id: c.client_id }} className="font-serif italic text-[15px] text-primary hover:underline decoration-gold underline-offset-4">
                    {coupleName(c)}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span className="px-2 py-0.5 rounded-full bg-background-alt text-[10px] uppercase tracking-wider text-foreground/70 border border-border">
                    {c.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{c.files}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtBytes(c.bytes)}</td>
                <td className="px-4 py-3 text-muted-foreground">{c.last_attachment_at ? relativeTime(c.last_attachment_at) : "—"}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => setDrillCouple(c)}
                    className="px-3 py-1 rounded-sm border border-gold/50 text-gold hover:bg-gold/10 text-[12px] uppercase tracking-wider"
                  >
                    Manage
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {drillCouple && (
        <DrillDownModal
          couple={drillCouple}
          onClose={() => { setDrillCouple(null); load(); }}
        />
      )}
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface rounded-md border border-primary/15 p-4">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="font-serif italic text-[26px] text-primary mt-1">{value}</p>
    </div>
  );
}

// ---------- Drill-down modal ----------
function DrillDownModal({ couple, onClose }: { couple: CoupleRow; onClose: () => void }) {
  const [items, setItems] = useState<AttRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [olderThan, setOlderThan] = useState<string>("");
  const [confirm, setConfirm] = useState<{ ids: string[]; bytes: number } | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data: msgs } = await supabase.from("messages").select("id").eq("conversation_id", couple.conversation_id);
    const ids = (msgs ?? []).map((m: any) => m.id);
    if (ids.length === 0) { setItems([]); setLoading(false); return; }
    const { data } = await supabase
      .from("message_attachments")
      .select("id, message_id, file_name, storage_path, file_size_bytes, mime_type, thumbnail_url, file_url, created_at, uploaded_by")
      .in("message_id", ids)
      .order("created_at", { ascending: false });
    setItems((data ?? []) as AttRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [couple.conversation_id]);

  const totalSelectedBytes = useMemo(
    () => items.filter((i) => selected.has(i.id)).reduce((s, i) => s + (i.file_size_bytes ?? 0), 0),
    [items, selected],
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((i) => i.id)));
  };

  const performDelete = async (ids: string[]) => {
    const rows = items.filter((i) => ids.includes(i.id));
    const paths = rows.map((r) => r.storage_path).filter(Boolean);
    if (paths.length) {
      const { error } = await supabase.storage.from("message-attachments").remove(paths);
      if (error) { toast.error("Storage delete failed: " + error.message); return; }
    }
    const { error: dbErr } = await supabase.from("message_attachments").delete().in("id", ids);
    if (dbErr) { toast.error("DB delete failed: " + dbErr.message); return; }
    // Best-effort activity log
    try {
      await supabase.from("activity_log").insert({
        action_type: "storage_attachments_deleted",
        target_type: "client",
        target_id: couple.client_id,
        description: `Deleted ${ids.length} attachment(s) (${fmtBytes(rows.reduce((s, r) => s + (r.file_size_bytes ?? 0), 0))})`,
        metadata: { client_id: couple.client_id, count: ids.length },
      });
    } catch { /* ignore */ }
    toast.success(`Deleted ${ids.length} file(s)`);
    setSelected(new Set());
    setConfirm(null);
    await load();
  };

  const requestDelete = (ids: string[]) => {
    if (ids.length === 0) { toast.info("Select files first."); return; }
    const bytes = items.filter((i) => ids.includes(i.id)).reduce((s, i) => s + (i.file_size_bytes ?? 0), 0);
    setConfirm({ ids, bytes });
  };

  const requestDeleteOlder = () => {
    if (!olderThan) { toast.info("Pick a date."); return; }
    const cutoff = new Date(olderThan).getTime();
    const ids = items.filter((i) => new Date(i.created_at).getTime() < cutoff).map((i) => i.id);
    if (ids.length === 0) { toast.info("No files older than that date."); return; }
    requestDelete(ids);
  };

  const exportZip = async () => {
    setExporting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/export-conversation-zip`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token ?? ""}`,
          "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ client_id: couple.client_id }),
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const a = document.createElement("a");
      const objUrl = URL.createObjectURL(blob);
      a.href = objUrl;
      a.download = `${couple.couple_name_1}-attachments.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
      toast.success("Export ready");
    } catch (e: any) {
      toast.error("Export failed: " + (e?.message ?? "unknown"));
    } finally {
      setExporting(false);
    }
  };

  const coupleName = `${couple.couple_name_1}${couple.couple_name_2 ? " & " + couple.couple_name_2 : ""}`;

  return (
    <div className="fixed inset-0 z-50 bg-plum/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background rounded-lg shadow-elevated w-full max-w-4xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="font-serif italic text-[22px] text-primary">{coupleName}</h2>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mt-0.5">
              {items.length} files · {fmtBytes(items.reduce((s, i) => s + (i.file_size_bytes ?? 0), 0))}
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-primary"><X size={18} /></button>
        </div>

        <div className="px-6 py-3 border-b border-border bg-background-alt flex items-center gap-3 flex-wrap">
          <button
            onClick={toggleAll}
            className="text-[12px] uppercase tracking-wider text-muted-foreground hover:text-primary"
          >
            {selected.size === items.length && items.length > 0 ? "Deselect all" : "Select all"}
          </button>
          <button
            onClick={() => requestDelete(Array.from(selected))}
            disabled={selected.size === 0}
            className="px-3 py-1 rounded-sm bg-magenta text-background text-[12px] uppercase tracking-wider disabled:opacity-40 inline-flex items-center gap-1"
          >
            <Trash2 size={12} /> Delete selected ({selected.size}) · {fmtBytes(totalSelectedBytes)}
          </button>
          <div className="flex items-center gap-2 ml-auto">
            <input
              type="date"
              value={olderThan}
              onChange={(e) => setOlderThan(e.target.value)}
              className="px-2 py-1 bg-surface border border-border rounded-sm text-[12px]"
            />
            <button
              onClick={requestDeleteOlder}
              className="px-3 py-1 rounded-sm border border-magenta/50 text-magenta hover:bg-magenta/10 text-[12px] uppercase tracking-wider"
            >
              Delete older than
            </button>
            <button
              onClick={exportZip}
              disabled={exporting || items.length === 0}
              className="px-3 py-1 rounded-sm border border-gold/50 text-gold hover:bg-gold/10 text-[12px] uppercase tracking-wider inline-flex items-center gap-1 disabled:opacity-40"
            >
              {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Export ZIP
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <p className="font-serif italic text-primary text-center">Loading…</p>
          ) : items.length === 0 ? (
            <p className="font-serif italic text-muted-foreground text-center">No attachments.</p>
          ) : (
            <ul className="space-y-2">
              {items.map((i) => {
                const isImage = i.mime_type?.startsWith("image/");
                return (
                  <li key={i.id} className="flex items-center gap-3 p-2 rounded-sm hover:bg-background-alt">
                    <input
                      type="checkbox"
                      checked={selected.has(i.id)}
                      onChange={() => toggle(i.id)}
                      className="h-4 w-4 accent-primary"
                    />
                    <div className="h-12 w-12 rounded-sm bg-background-alt border border-border flex items-center justify-center shrink-0 overflow-hidden">
                      {isImage && i.thumbnail_url ? (
                        <img src={i.thumbnail_url} alt={i.file_name} className="h-full w-full object-cover" />
                      ) : isImage ? (
                        <ImageIcon size={18} className="text-muted-foreground" />
                      ) : (
                        <FileText size={18} className="text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground truncate">{i.file_name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {fmtBytes(i.file_size_bytes ?? 0)} · {relativeTime(i.created_at)}
                      </p>
                    </div>
                    {i.file_url && (
                      <a
                        href={i.file_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted-foreground hover:text-gold p-1"
                        title="Download"
                      >
                        <Download size={14} />
                      </a>
                    )}
                    <button
                      onClick={() => requestDelete([i.id])}
                      className="text-muted-foreground hover:text-magenta p-1"
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {confirm && (
        <div className="fixed inset-0 z-[60] bg-plum/70 flex items-center justify-center p-4" onClick={() => setConfirm(null)}>
          <div className="bg-background rounded-lg shadow-elevated max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-serif italic text-[22px] text-primary">Delete {confirm.ids.length} files ({fmtBytes(confirm.bytes)})?</h3>
            <p className="text-sm text-muted-foreground mt-3">
              This cannot be undone. The messages remain but the files will be permanently removed.
            </p>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setConfirm(null)}
                className="px-4 py-2 rounded-sm border border-border text-muted-foreground hover:text-primary text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => performDelete(confirm.ids)}
                className="px-4 py-2 rounded-sm bg-magenta text-background text-sm"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
