import { useEffect, useState } from "react";
import { X, Upload, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function UploadSignedContractModal({
  clientId,
  onClose,
  onSaved,
}: {
  clientId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("Signed Contract");
  const [signedDate, setSignedDate] = useState(new Date().toISOString().slice(0, 10));
  const [counterParty, setCounterParty] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onEsc);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onEsc); document.body.style.overflow = ""; };
  }, [onClose]);

  const submit = async () => {
    if (!file) { toast.error("Please choose a PDF."); return; }
    if (file.type !== "application/pdf") { toast.error("Only PDF files are accepted."); return; }
    if (!signedDate) { toast.error("Please choose the signed date."); return; }
    setBusy(true);
    try {
      const id = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const path = `${clientId}/${id}.pdf`;
      const up = await supabase.storage
        .from("signed-contracts")
        .upload(path, file, { contentType: "application/pdf", upsert: false });
      if (up.error) throw up.error;

      const signedAtIso = new Date(`${signedDate}T12:00:00`).toISOString();
      const { error: insErr } = await supabase.from("contracts").insert({
        client_id: clientId,
        title: title.trim() || "Signed Contract",
        file_url: path,
        status: "signed",
        signed_at: signedAtIso,
        sent_at: signedAtIso,
        is_block_based: false,
        contract_kind: "couple",
        counter_party_name: counterParty.trim() || null,
        content: "Uploaded signed contract (migrated from Dubsado).",
      });
      if (insErr) {
        // best-effort cleanup
        await supabase.storage.from("signed-contracts").remove([path]).catch(() => {});
        throw insErr;
      }
      toast.success("Signed contract uploaded.");
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-plum/70 flex items-stretch md:items-center justify-center p-0 md:p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface w-full md:max-w-[520px] max-h-screen md:max-h-[90vh] flex flex-col md:rounded-lg shadow-elevated overflow-hidden"
      >
        <div className="sticky top-0 bg-surface border-b border-gold/30 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="font-serif italic text-xl text-primary">Upload signed contract</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-magenta" aria-label="Close"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          <p className="text-sm text-muted-foreground">
            For couples who signed outside the app (e.g. migrated from Dubsado). This uploads the PDF and records a signed contract on their file.
          </p>
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">PDF file</label>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-3 file:px-3 file:py-1.5 file:rounded-md file:border-0 file:bg-primary file:text-primary-foreground file:text-xs file:cursor-pointer"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Signed date</label>
            <input
              type="date"
              value={signedDate}
              onChange={(e) => setSignedDate(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Counter-party name (optional)</label>
            <input
              type="text"
              value={counterParty}
              onChange={(e) => setCounterParty(e.target.value)}
              placeholder="e.g. Sophia & Marcus Reyes"
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
            />
          </div>
        </div>
        <div className="sticky bottom-0 bg-surface border-t border-gold/30 px-6 py-4 flex justify-end gap-3">
          <button onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground px-3 py-2">Cancel</button>
          <button
            onClick={submit}
            disabled={busy || !file}
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {busy ? "Uploading…" : "Upload contract"}
          </button>
        </div>
      </div>
    </div>
  );
}

export async function openSignedContractPdf(path: string): Promise<void> {
  const { data, error } = await supabase.storage
    .from("signed-contracts")
    .createSignedUrl(path, 300);
  if (error || !data?.signedUrl) {
    toast.error(error?.message ?? "Could not open PDF.");
    return;
  }
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}
