import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { buildClientPlaceholderContext, resolvePlaceholders, type PlaceholderContext } from "@/lib/placeholders";
import { SIGNER_ROLE_LABELS, type SignerRole } from "@/lib/contractBlocks";

interface Props {
  templateId: string;
  clientId: string;
}

interface Block {
  id: string;
  position: number;
  block_type: string;
  config: any;
  content: string | null;
}

export function BlockBasedContractPreview({ templateId, clientId }: Props) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [ctx, setCtx] = useState<PlaceholderContext | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: tplBlocks }, { data: client }, { data: studio }] = await Promise.all([
        supabase.from("contract_template_blocks").select("*").eq("template_id", templateId).order("position"),
        supabase.from("clients").select("couple_name_1, couple_name_2, wedding_date, venue_name, primary_email").eq("id", clientId).maybeSingle(),
        supabase.from("studio_settings").select("photographer_name, photographer_company, studio_email, studio_phone").eq("is_active", true).maybeSingle(),
      ]);
      if (cancelled) return;
      setBlocks((tplBlocks ?? []) as any);
      if (client) {
        setCtx(buildClientPlaceholderContext(client as any, {
          photographerName: (studio as any)?.photographer_name,
          photographerCompany: (studio as any)?.photographer_company,
          studioEmail: (studio as any)?.studio_email,
          studioPhone: (studio as any)?.studio_phone,
        }));
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [templateId, clientId]);

  if (loading) return <p className="text-sm text-muted-foreground italic p-4">Loading preview…</p>;
  if (!blocks.length) return <p className="text-sm text-muted-foreground italic p-4">This template has no blocks yet.</p>;

  const signerLabel = (role: string | undefined) => {
    if (!role) return "Signer";
    return SIGNER_ROLE_LABELS[role as SignerRole] ?? role;
  };

  return (
    <div className="space-y-4">
      {blocks.map((b) => {
        const cfg = b.config ?? {};
        switch (b.block_type) {
          case "text_box": {
            const html = resolvePlaceholders(b.content || cfg.content || "", ctx ?? {});
            return (
              <div key={b.id} className="prose prose-sm max-w-none text-foreground" dangerouslySetInnerHTML={{ __html: html }} />
            );
          }
          case "image":
            return cfg.url ? <img key={b.id} src={cfg.url} alt={cfg.alt ?? ""} className="max-w-full rounded" /> : null;
          case "divider":
            return <hr key={b.id} className={`border-t ${cfg.style === "gold" ? "border-gold" : cfg.style === "dashed" ? "border-dashed border-border" : "border-border"}`} />;
          case "spacer":
            return <div key={b.id} style={{ height: cfg.size === "large" ? 48 : cfg.size === "small" ? 12 : 24 }} />;
          case "short_answer":
            return (
              <div key={b.id}>
                <label className="text-xs uppercase tracking-wider text-muted-foreground block mb-1">{cfg.label}{cfg.required && <span className="text-magenta"> *</span>}</label>
                <div className="px-3 py-2 bg-background-alt border border-dashed border-border rounded text-sm text-muted-foreground italic">Couple will fill in</div>
              </div>
            );
          case "free_response":
            return (
              <div key={b.id}>
                <label className="text-xs uppercase tracking-wider text-muted-foreground block mb-1">{cfg.label}{cfg.required && <span className="text-magenta"> *</span>}</label>
                <div className="px-3 py-6 bg-background-alt border border-dashed border-border rounded text-sm text-muted-foreground italic">Couple will write a longer response</div>
              </div>
            );
          case "date_select":
            return (
              <div key={b.id}>
                <label className="text-xs uppercase tracking-wider text-muted-foreground block mb-1">{cfg.label}{cfg.required && <span className="text-magenta"> *</span>}</label>
                <div className="px-3 py-2 bg-background-alt border border-dashed border-border rounded text-sm text-muted-foreground italic">📅 Couple will select a date</div>
              </div>
            );
          case "initials":
            return (
              <div key={b.id} className="flex items-center gap-3 bg-gold/5 border border-gold/40 rounded p-3">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">{cfg.label}</div>
                <div className="ml-auto px-4 py-2 border border-dashed border-gold rounded text-xs text-muted-foreground italic">Initials — {signerLabel(cfg.signer_role)}</div>
              </div>
            );
          case "signature":
            return (
              <div key={b.id} className="bg-gold/5 border border-gold/40 rounded p-4">
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Signature — {signerLabel(cfg.signer_role)}</div>
                <div className="px-4 py-8 border border-dashed border-gold rounded text-center text-sm text-muted-foreground italic">{signerLabel(cfg.signer_role)} will sign here</div>
              </div>
            );
          case "dropdown":
            return (
              <div key={b.id}>
                <label className="text-xs uppercase tracking-wider text-muted-foreground block mb-1">{cfg.label}{cfg.required && <span className="text-magenta"> *</span>}</label>
                <div className="px-3 py-2 bg-background-alt border border-dashed border-border rounded text-sm text-muted-foreground italic">{cfg.options?.[0]?.label ?? "Choose…"} ▾</div>
              </div>
            );
          case "checkboxes":
            return (
              <div key={b.id}>
                <label className="text-xs uppercase tracking-wider text-muted-foreground block mb-1">{cfg.label}{cfg.required && <span className="text-magenta"> *</span>}</label>
                <div className="space-y-1">
                  {(cfg.options ?? []).map((o: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground"><span className="inline-block w-3 h-3 border border-border rounded-sm" /> {o.label}</div>
                  ))}
                </div>
              </div>
            );
          case "multiple_choice":
            return (
              <div key={b.id}>
                <label className="text-xs uppercase tracking-wider text-muted-foreground block mb-1">{cfg.label}{cfg.required && <span className="text-magenta"> *</span>}</label>
                <div className="space-y-1">
                  {(cfg.options ?? []).map((o: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground"><span className="inline-block w-3 h-3 border border-border rounded-full" /> {o.label}</div>
                  ))}
                </div>
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
