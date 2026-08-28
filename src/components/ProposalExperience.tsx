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

const PILLARS = [
  { title: "True to color", body: "Your flowers, your outfits, your skin tones, rendered the way they actually looked. Edited by hand, never batch-filtered." },
  { title: "Two traditions, honored", body: "Multicultural and double-ceremony days are choreography. Coverage is planned so no ritual, outfit change, or family moment is missed." },
  { title: "Directed, not stiff", body: "I'll guide you when you want it and disappear when you don't, so you look like yourselves, only on your best day." },
];

const STEPS = [
  { t: "You say yes", b: "Accept your proposal right here. Your date is pencilled the moment you do." },
  { t: "Contract & retainer", b: "Sign online in minutes. Your retainer officially locks your date. No one else can book it." },
  { t: "We plan your day", b: "Timeline building, family photo lists, sunset math, venue walk-through, all managed inside your portal, together." },
  { t: "Your wedding day", b: "We arrive early, stay late, and photograph like it's the only wedding we'll ever shoot. Because that day, it is." },
  { t: "Sneak peeks within a week", b: "At least 100 curated photos while the celebration is still fresh. Perfect for thank-yous and announcements." },
  { t: "Your full gallery", b: "Hundreds of hand-edited images in a beautiful online gallery with printing rights and three years of storage." },
];

const ADDONS = [
  { n: "Heirloom wedding album", d: "Lay-flat and hand-designed, the one your grandkids will find.", p: 1133 },
  { n: "Parent albums", d: "A smaller copy of your album for each family.", p: 721 },
  { n: "Rehearsal dinner coverage", d: "The night-before toasts, in the same true-to-color style.", p: 1545 },
  { n: "35mm film add-on", d: "A roll of real film shot alongside digital. Texture you can't fake.", p: 412 },
  { n: "Second videographer", d: "A second angle on the ceremonies and dances.", p: 1030 },
  { n: "Additional event coverage", d: "Sangeet, mehndi, or welcome party coverage.", p: 824 },
];

const FAQS = [
  { q: "How many photos will we receive?", a: "A full wedding day typically delivers 700 to 1,200+ hand-edited images depending on coverage length, in both high-resolution and web-ready sizes, with full printing rights." },
  { q: "When will we see our photos?", a: "Sneak peeks land within a week, at least 100 photos. Your complete gallery is delivered within 6 to 8 weeks, every image individually edited, never rushed through a batch filter." },
  { q: "Do you have experience with cultural ceremonies?", a: "Yes, and when a ceremony is new to us, we work with the couple to learn the rituals and plan a well-documented, artistic approach that covers both the moment and the emotion behind it." },
  { q: "How do payments work?", a: "A retainer secures your date, and the remainder is split into a friendly payment schedule inside your client portal, so you'll always see exactly what's due and when, and pay securely online." },
  { q: "What if our timeline changes?", a: "Timelines always evolve. That's normal. We build yours together in the portal, and I adjust coverage planning as your day takes shape." },
  { q: "Can we adjust a package?", a: "Always. These options are starting points, not boxes. Use the request-a-change button below, or just tell me what you'd shift." },
  { q: "Do you travel?", a: "Yes. Travel within 100 miles of the SBV studio base is included, and beyond that we'll quote travel simply and transparently." },
];

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-3">{children}</p>;
}
function SectionH({ n, eyebrow, title }: { n: string; eyebrow: string; title: string }) {
  return (
    <div className="mb-2">
      <p className="font-serif italic text-[15px] text-gold mb-1">{n}</p>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="font-serif italic text-3xl text-primary">{title}</h2>
    </div>
  );
}

// The couple-facing proposal experience: the full kit (approach, process,
// add-ons, Q&A) with the decision flow at the bottom. Used live in the
// portal and read-only in the studio preview, so the two never drift apart.
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

  const [pickedAddons, setPickedAddons] = useState<Set<number>>(new Set());
  const addonSum = [...pickedAddons].reduce((s, i) => s + ADDONS[i].p, 0);

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
    let note = acceptNote.trim();
    if (pickedAddons.size > 0) {
      const names = [...pickedAddons].map((i) => ADDONS[i].n).join(", ");
      note = note ? `${note}\n\nInterested in add-ons: ${names}` : `Interested in add-ons: ${names}`;
    }
    await onAccept(selected?.key ?? null, note || null);
    setAccepting(false);
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

  const img = (name: string, alt: string, cls = "") => (
    <img src={`/proposal/${name}`} alt={alt} loading="lazy" className={`w-full aspect-[3/4] object-cover rounded-lg ${cls}`} />
  );

  return (
    <>
      {/* Cover */}
      <div className="relative bg-plum text-primary-foreground text-center px-6 py-14 md:py-20 overflow-hidden">
        <img src="/proposal/cover.jpg" alt="" className="absolute inset-0 w-full h-full object-cover opacity-25" style={{ objectPosition: "center 38%", filter: "saturate(.6)" }} />
        <div className="relative">
          <p className="font-serif italic text-lg mb-5">Stories <span className="text-xs tracking-[0.2em]">BY</span> Victoria</p>
          <h1 className="font-serif italic text-4xl md:text-5xl text-gold mb-4">Your Wedding, Proposed.</h1>
          {coupleNames && <p className="font-serif italic text-xl" style={{ color: "#F0A5BE" }}>{coupleNames}</p>}
          {weddingDateTxt && (
            <p className="text-xs uppercase tracking-[0.18em] opacity-85 mt-1">
              {weddingDateTxt}{client?.venue_name ? ` · ${client.venue_name}` : ""}
            </p>
          )}
          <div className="w-16 h-px bg-gold mx-auto mt-7" />
          <p className="text-sm opacity-85 mt-6 max-w-md mx-auto">Your love story, captured like a rom-com classic: vibrant, true to color, and unmistakably yours.</p>
        </div>
      </div>

      <div className="px-6 md:px-10 py-10 space-y-14">
        {/* 01 Note */}
        {proposal.personal_note && (
          <section>
            <SectionH n="01" eyebrow="A note from Victoria" title="Written for you." />
            <div className="bg-surface rounded-lg border-t-2 border-gold shadow-soft p-7 md:p-9 mt-4">
              <p className="font-serif italic text-lg text-primary/90 whitespace-pre-wrap">{proposal.personal_note}</p>
            </div>
          </section>
        )}

        {/* 02 Approach */}
        <section>
          <SectionH n="02" eyebrow="How I photograph a wedding" title="Bright, true to color, and honest." />
          <p className="mt-3 max-w-xl text-foreground">No moody over-filtering, no washed-out trends that date your gallery in five years. I blend classic traditional portraiture (the photographs your families will frame) with a photojournalist's eye for the in-between moments no one posed for.</p>
          <div className="grid md:grid-cols-3 gap-4 mt-6">
            {PILLARS.map((p) => (
              <div key={p.title} className="bg-accent rounded-lg p-6">
                <h3 className="font-serif italic text-lg text-primary mb-2">{p.title}</h3>
                <p className="text-sm text-muted-foreground">{p.body}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
            {img("bouquet.jpg", "Vibrant wildflower bouquet held by a couple")}
            {img("golden.jpg", "Golden hour portrait overlooking the Hudson valley")}
            {img("letter.jpg", "Couple reading a letter together, black and white")}
            {img("party.jpg", "Guest in a red dress celebrating on the lawn")}
          </div>
        </section>

        {/* 03 Options */}
        <section>
          <SectionH n="03" eyebrow={`Prepared exclusively for ${coupleNames || "you"}`} title="Choose your experience." />
          <p className="mt-3 max-w-xl text-foreground">Tap the option that feels right. Neither is a compromise; they're two honest ways to shape the same day.</p>
          {hasOptions ? (
            <div className="grid md:grid-cols-2 gap-4 mt-6">
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
                    <span className={`mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${optionHighlighted(o) ? "border-gold bg-gold text-surface" : "border-border"}`}>
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
          ) : (
            <table className="w-full mt-6">
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
          )}
          <p className="text-sm text-muted-foreground italic mt-4">Every proposal is flexible. Packaging can always be adjusted to your preferences. Just ask.</p>
        </section>

        {/* 04 Experience */}
        <section>
          <SectionH n="04" eyebrow="The experience" title={'From "yes" to your gallery.'} />
          <div className="mt-4">
            {STEPS.map((s, i) => (
              <div key={s.t} className="grid grid-cols-[56px_1fr] gap-4 py-5 border-b border-border last:border-none">
                <span className="font-serif italic text-2xl text-gold">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h3 className="font-serif italic text-lg text-primary mb-1">{s.t}</h3>
                  <p className="text-sm text-muted-foreground">{s.b}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-6">
            {img("dock.jpg", "Couple laughing on a dock at sunset")}
            {img("cultural.jpg", "Bride in a red lehenga with mehndi under cherry blossoms")}
            {img("hug.jpg", "First look embrace by the lake, black and white")}
          </div>
        </section>

        {/* 05 Add-ons */}
        <section>
          <SectionH n="05" eyebrow="Make it yours" title="Add-ons & heirlooms." />
          <p className="mt-3 max-w-xl text-foreground">Tap anything you're curious about. Nothing is committed; whatever you mark simply comes along with your acceptance so we can talk it through.</p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3 mt-6">
            {ADDONS.map((a, i) => {
              const on = pickedAddons.has(i);
              return (
                <button
                  key={a.n}
                  type="button"
                  onClick={() => setPickedAddons((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })}
                  className={`text-left rounded-lg border p-4 flex gap-3 items-start transition ${on ? "border-gold bg-accent/50" : "border-border bg-surface hover:border-gold/60"}`}
                >
                  <span className={`mt-0.5 inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border ${on ? "border-gold bg-gold text-surface" : "border-border"}`}>
                    {on && <Check size={11} />}
                  </span>
                  <span className="flex-1">
                    <span className="block text-sm font-medium text-foreground">{a.n}</span>
                    <span className="block text-xs text-muted-foreground mt-0.5">{a.d}</span>
                  </span>
                  <span className="font-serif italic text-primary whitespace-nowrap">${a.p.toLocaleString()}</span>
                </button>
              );
            })}
          </div>
          {addonSum > 0 && (
            <p className="text-sm text-muted-foreground mt-4">
              Selected add-ons: <span className="font-serif italic text-lg text-primary">${addonSum.toLocaleString()}</span>
              {selected ? ` — with ${selected.name}, roughly $${(Number(selected.total) + addonSum).toLocaleString()} all in.` : ""}
            </p>
          )}
        </section>

        {/* 06 Q&A */}
        <section>
          <SectionH n="06" eyebrow="Questions, answered" title="Q&A" />
          <div className="mt-4">
            {FAQS.map((f) => (
              <details key={f.q} className="border-b border-border group">
                <summary className="cursor-pointer list-none flex justify-between items-center gap-4 py-4 font-serif italic text-lg text-primary [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span className="text-gold text-xl transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="pb-5 text-sm text-muted-foreground max-w-xl">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* 07 Decision */}
        <section className="bg-plum text-primary-foreground rounded-xl p-7 md:p-10 -mx-2 md:mx-0">
          <p className="text-[11px] uppercase tracking-[0.18em] mb-2" style={{ color: "#F0A5BE" }}>What happens next</p>
          <h2 className="font-serif italic text-3xl mb-2">Three small steps, one big yes.</h2>
          <p className="text-sm opacity-85 mb-6">Accept below, sign your contract online, place the retainer. Then your date is officially yours and the planning begins, all in this portal.</p>

          {proposal.valid_until && (
            <p className="text-xs uppercase tracking-[0.14em] opacity-70 mb-6">This proposal is reserved for {coupleNames || "you"} and valid until {shortDate(proposal.valid_until)}.</p>
          )}

          {isAccepted ? (
            <div className="flex items-center gap-2">
              <Check size={16} className="text-gold" />
              <span className="font-serif italic text-lg">
                {selected ? `"${selected.name}" accepted` : "Proposal accepted"}
                {proposal.accepted_at ? ` on ${shortDate(proposal.accepted_at)}` : ""}.
              </span>
            </div>
          ) : (
            <div className="space-y-4">
              <textarea
                value={acceptNote}
                onChange={(e) => setAcceptNote(e.target.value)}
                rows={2}
                maxLength={2000}
                placeholder="Optional: add a note for Victoria along with your acceptance."
                className="w-full px-3 py-2 rounded-md text-sm bg-surface text-foreground border border-transparent"
              />
              <button
                onClick={accept}
                disabled={accepting || (hasOptions && !selected)}
                className="bg-magenta text-white px-6 py-3 rounded-md text-sm font-semibold hover:opacity-90 disabled:opacity-50"
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
                <p className="text-sm opacity-85">
                  Your change request has been sent. Victoria will follow up shortly. You can still accept an option at any time.
                </p>
              ) : showChange ? (
                <div className="space-y-2">
                  <textarea
                    value={changeNote}
                    onChange={(e) => setChangeNote(e.target.value)}
                    rows={3}
                    maxLength={2000}
                    placeholder="Tell me what you'd like different: coverage, timing, packaging, or something else entirely. I'll revise and send it back."
                    className="w-full px-3 py-2 rounded-md text-sm bg-surface text-foreground border border-transparent"
                  />
                  <div className="flex gap-3">
                    <button onClick={sendChange} disabled={sendingChange} className="border border-gold text-gold px-4 py-2 rounded-md text-sm hover:bg-gold/10 disabled:opacity-50">
                      {sendingChange ? "Sending…" : "Send request"}
                    </button>
                    <button onClick={() => setShowChange(false)} className="text-sm opacity-75 hover:opacity-100">Cancel</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowChange(true)} className="block text-sm text-gold underline underline-offset-4 hover:opacity-80">
                  These options not quite right? Ask for something different
                </button>
              )}
            </div>
          )}
        </section>

        <p className="text-center text-xs text-muted-foreground pb-2">
          Stories by Victoria · Brooklyn, NY · victoriaboustani.com
        </p>
      </div>
    </>
  );
}
