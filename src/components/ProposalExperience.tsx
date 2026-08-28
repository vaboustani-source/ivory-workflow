import { useState } from "react";
import { Check } from "lucide-react";
import { shortDate } from "@/lib/dates";
import { toast } from "sonner";

export interface ProposalOptionData {
  key: string; name: string; description?: string;
  line_items: Array<{ label: string; amount: number }>;
  subtotal?: number; discount?: number; total: number;
}
export interface ProposalData {
  id: string; status: string; sent_at: string | null; accepted_at: string | null;
  line_items: any; subtotal: number | null; total: number | null; discount: number | null;
  personal_note: string | null; valid_until: string | null;
  options: ProposalOptionData[] | null; selected_option: string | null;
  change_request: string | null; change_requested_at: string | null;
}
export interface CoupleLite {
  couple_name_1?: string | null; couple_name_2?: string | null;
  wedding_date?: string | null; venue_name?: string | null;
}

// The couple-facing proposal experience. Used live in the portal and as a
// read-only preview in the studio, so the two can never drift apart.
export function ProposalExperience({ proposal, client, preview, onAccept, onRequestChange }: {
  proposal: ProposalData;
  client: CoupleLite | null;
  preview?: boolean;
  onAccept?: (optionKey: string | null, note: string | null) => Promise<boolean>;
  onRequestChange?: (note: string) => Promise<boolean>;
}) {
  const options: ProposalOptionData[] = Array.isArray(proposal.options) ? proposal.options : [];
  const hasOptions = options.length > 0;
  const isAccepted = proposal.status === "accepted";
  const [selectedKey, setSelectedKey] = useState<string | null>(
    proposal.selected_option ?? (options.length === 1 ? options[0].key : null),
  );
  const selected = options.find((o) => o.key === selectedKey) ?? null;

  const [accepting, setAccepting] = useState(false);
  const [acceptNote, setAcceptNote] = useState("");
  const [showChange, setShowChange] = useState(false);
  const [changeNote, setChangeNote] = useState("");
  const [sendingChange, setSendingChange] = useState(false);
  const [changeSent, setChangeSent] = useState(false);
  const changeRequested = changeSent || !!proposal.change_request;

  const items: Array<{ label: string; amount: number }> = Array.isArray(proposal.line_items) ? proposal.line_items : [];

  const coupleNames = client?.couple_name_2
    ? `${client.couple_name_1} & ${client.couple_name_2}`
    : (client?.couple_name_1 ?? "");
  const weddingDateTxt = client?.wedding_date
    ? new Date(client.wedding_date + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : null;

  const accept = async () => {
    if (preview || !onAccept) { toast("Preview only. This is exactly what your couple sees."); return; }
    if (hasOptions && !selected) { toast.error("Choose an option first."); return; }
    setAccepting(true);
    const ok = await onAccept(selected?.key ?? null, acceptNote.trim() || null);
    setAccepting(false);
    if (!ok) return;
  };

  const sendChange = async () => {
    if (preview || !onRequestChange) { toast("Preview only. This is exactly what your couple sees."); return; }
    const note = changeNote.trim();
    if (!note) { toast.error("Tell us what you'd like adjusted."); return; }
    setSendingChange(true);
    const ok = await onRequestChange(note);
    setSendingChange(false);
    if (ok) { setChangeSent(true); setShowChange(false); }
  };

  const optionHighlighted = (o: ProposalOptionData) =>
    isAccepted ? proposal.selected_option === o.key : selectedKey === o.key;

  return (
    <>
      <div className="bg-plum text-primary-foreground text-center px-6 py-12 md:py-16">
        <p className="font-serif italic text-lg mb-5">Stories <span className="text-xs tracking-[0.2em]">BY</span> Victoria</p>
        <h1 className="font-serif italic text-4xl md:text-5xl text-gold mb-4">Your Wedding, Proposed.</h1>
        {coupleNames && <p className="font-serif italic text-xl" style={{ color: "#F0A5BE" }}>{coupleNames}</p>}
        {weddingDateTxt && (
          <p className="text-xs uppercase tracking-[0.18em] opacity-85 mt-1">
            {weddingDateTxt}{client?.venue_name ? ` · ${client.venue_name}` : ""}
          </p>
        )}
        <div className="w-16 h-px bg-gold mx-auto mt-7" />
      </div>

      <div className="px-6 md:px-10 py-8 space-y-8">
        {proposal.personal_note && (
          <div className="bg-surface rounded-lg border-t-2 border-gold shadow-soft p-7 md:p-9">
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-4">A note from Victoria</p>
            <p className="font-serif italic text-lg text-primary/90 whitespace-pre-wrap">{proposal.personal_note}</p>
          </div>
        )}

        {hasOptions ? (
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-3">
              {isAccepted ? "Your selection" : "Choose your experience"}
            </p>
            <div className="grid md:grid-cols-2 gap-4">
              {options.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => { if (!isAccepted) setSelectedKey(o.key); }}
                  className={`text-left rounded-lg border p-5 transition flex flex-col gap-3 ${
                    optionHighlighted(o)
                      ? "border-gold ring-2 ring-gold/40 bg-accent/40"
                      : "border-border bg-surface hover:border-gold/60"
                  } ${isAccepted && proposal.selected_option !== o.key ? "opacity-40" : ""}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-serif italic text-xl text-primary">{o.name}</h4>
                    <span
                      className={`mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                        optionHighlighted(o) ? "border-gold bg-gold text-surface" : "border-border"
                      }`}
                    >
                      {optionHighlighted(o) && <Check size={12} />}
                    </span>
                  </div>
                  <p className="text-2xl text-foreground font-medium">${Number(o.total).toLocaleString()}</p>
                  {o.description && <p className="text-sm text-muted-foreground">{o.description}</p>}
                  <ul className="space-y-1.5 mt-1">
                    {(o.line_items ?? []).map((it, idx) => (
                      <li key={idx} className="flex justify-between gap-3 text-sm text-foreground border-b border-border/40 pb-1.5">
                        <span>{it.label}</span>
                        <span className="whitespace-nowrap">${Number(it.amount).toLocaleString()}</span>
                      </li>
                    ))}
                    {o.discount != null && Number(o.discount) > 0 && (
                      <li className="flex justify-between gap-3 text-sm text-muted-foreground">
                        <span>Included savings</span>
                        <span>−${Number(o.discount).toLocaleString()}</span>
                      </li>
                    )}
                  </ul>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-3">Investment summary</p>
            <table className="w-full">
              <tbody>
                {items.map((it, idx) => (
                  <tr key={idx} className="border-b border-border/50">
                    <td className="py-3 text-sm text-foreground">{it.label}</td>
                    <td className="py-3 text-sm text-foreground text-right">${Number(it.amount).toLocaleString()}</td>
                  </tr>
                ))}
                {proposal.discount && Number(proposal.discount) > 0 && (
                  <tr className="border-b border-border/50">
                    <td className="py-3 text-sm text-muted-foreground">Discount</td>
                    <td className="py-3 text-sm text-muted-foreground text-right">−${Number(proposal.discount).toLocaleString()}</td>
                  </tr>
                )}
                <tr>
                  <td className="pt-4 font-serif italic text-lg text-primary">Total</td>
                  <td className="pt-4 font-serif italic text-lg text-primary text-right">${Number(proposal.total ?? 0).toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {proposal.valid_until && (
          <p className="text-xs text-muted-foreground">Valid until {shortDate(proposal.valid_until)}.</p>
        )}

        <div className="border-t border-gold/30 pt-6 space-y-4">
          {isAccepted ? (
            <div className="flex items-center gap-2 text-sage">
              <Check size={16} />
              <span className="font-serif italic text-lg text-primary">
                {selected ? `"${selected.name}" accepted` : "Proposal accepted"}
                {proposal.accepted_at ? ` on ${shortDate(proposal.accepted_at)}` : ""}.
              </span>
            </div>
          ) : (
            <>
              <textarea
                value={acceptNote}
                onChange={(e) => setAcceptNote(e.target.value)}
                rows={2}
                maxLength={2000}
                placeholder="Optional: add a note for Victoria along with your acceptance."
                className="input"
              />
              <button
                onClick={accept}
                disabled={accepting || (hasOptions && !selected)}
                className="bg-primary text-primary-foreground px-6 py-2.5 rounded-md text-sm hover:bg-primary/90 disabled:opacity-50"
              >
                {accepting
                  ? "Accepting…"
                  : hasOptions
                    ? selected
                      ? `Accept "${selected.name}" — $${Number(selected.total).toLocaleString()}`
                      : "Select an option above"
                    : "I accept this proposal"}
              </button>

              {changeRequested ? (
                <p className="text-sm text-muted-foreground">
                  Your change request has been sent — Victoria will follow up shortly. You can still accept an option above at any time.
                </p>
              ) : showChange ? (
                <div className="space-y-2">
                  <textarea
                    value={changeNote}
                    onChange={(e) => setChangeNote(e.target.value)}
                    rows={3}
                    maxLength={2000}
                    placeholder="Tell me what you'd like different: coverage, timing, packaging, or something else entirely. I'll revise and send it back."
                    className="input"
                  />
                  <div className="flex gap-3">
                    <button
                      onClick={sendChange}
                      disabled={sendingChange}
                      className="border border-gold text-gold px-4 py-2 rounded-md text-sm hover:bg-gold/10 disabled:opacity-50"
                    >
                      {sendingChange ? "Sending…" : "Send request"}
                    </button>
                    <button onClick={() => setShowChange(false)} className="text-sm text-muted-foreground hover:text-magenta">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowChange(true)} className="text-sm text-gold hover:text-magenta underline underline-offset-4">
                  These options not quite right? Ask for something different
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
