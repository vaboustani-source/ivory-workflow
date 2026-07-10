import { useState } from "react";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { fmtCents } from "@/lib/invoiceMath";

interface Props {
  open: boolean;
  clientId: string | null;
  depositCents: number;
  onClose: () => void;
  onCancelled: () => void;
}

export function CancellationModal({ open, clientId, depositCents, onClose, onCancelled }: Props) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const handle = async () => {
    if (!clientId || !reason.trim()) { toast.error("Reason required."); return; }
    setSubmitting(true);
    const { error: rpcErr } = await supabase.rpc("cancel_tbd_booking", {
      p_client_id: clientId, p_reason: reason.trim(),
    });
    setSubmitting(false);
    if (rpcErr) { toast.error(`Couldn't cancel: ${rpcErr.message}`); return; }
    toast.success(`Date hold cancelled. ${fmtCents(depositCents)} retained as kill fee.`);
    onCancelled(); onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,15,15,0.45)" }} onClick={onClose}>
      <div className="w-full max-w-[480px] rounded-md shadow-xl" style={{ background: "var(--sbv-pink-soft)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between px-7 pt-6">
          <h2 className="font-serif text-2xl" style={{ color: "var(--sbv-green)" }}>Cancel date hold?</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-black/5" style={{ color: "var(--sbv-purple)" }}><X size={18} /></button>
        </div>
        <div className="px-7 py-5 space-y-4">
          <p className="text-sm" style={{ color: "var(--sbv-purple)" }}>
            The {fmtCents(depositCents)} deposit will be retained as a kill fee. The wedding date will be released and this client will return to lead status.
          </p>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "var(--sbv-purple)" }}>Cancellation reason (internal note)</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
              className="w-full rounded-sm px-3 py-2 text-sm"
              style={{ background: "white", color: "var(--sbv-purple)", border: "1px solid rgba(65,25,40,0.2)" }} />
          </div>
        </div>
        <div className="px-7 py-4 flex justify-end items-center gap-4" style={{ borderTop: "1px solid rgba(65,25,40,0.18)" }}>
          <button onClick={onClose} className="text-sm" style={{ color: "var(--sbv-purple)" }}>Keep booking</button>
          <button onClick={handle} disabled={submitting || !reason.trim()}
            className="px-5 py-2.5 rounded-sm text-sm font-medium text-white disabled:opacity-50"
            style={{ background: "var(--sbv-green)" }}>
            {submitting ? "Cancelling…" : "Cancel & retain deposit"}
          </button>
        </div>
      </div>
    </div>
  );
}
