import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { resolvePlaceholders, SAMPLE_CONTEXT, PLACEHOLDER_LIST, type PlaceholderContext } from "@/lib/placeholders";

interface Props {
  content: string;
  onContentChange: (v: string) => void;
  signatureRequiredRole: "partner_1" | "both_partners";
  onSignatureRoleChange: (v: "partner_1" | "both_partners") => void;
  previewContext?: PlaceholderContext;
  showSignatureField?: boolean;
}

/**
 * Two-column markdown editor with live preview.
 * Used by both the template editor and the per-couple contract editor.
 */
export function ContractMarkdownEditor({
  content, onContentChange,
  signatureRequiredRole, onSignatureRoleChange,
  previewContext, showSignatureField = true,
}: Props) {
  const ctx = previewContext ?? SAMPLE_CONTEXT;
  const rendered = useMemo(() => resolvePlaceholders(content, ctx), [content, ctx]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        {showSignatureField && (
          <div>
            <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground block mb-2">
              Signature requirement
            </label>
            <div className="space-y-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={signatureRequiredRole === "partner_1"}
                  onChange={() => onSignatureRoleChange("partner_1")}
                  className="mt-1 accent-primary"
                />
                <span className="text-sm text-foreground">Single signer (partner 1 only)</span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={signatureRequiredRole === "both_partners"}
                  onChange={() => onSignatureRoleChange("both_partners")}
                  className="mt-1 accent-primary"
                />
                <span className="text-sm text-foreground">Both partners required</span>
              </label>
            </div>
          </div>
        )}

        <div>
          <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground block mb-2">
            Contract body
          </label>
          <textarea
            value={content}
            onChange={(e) => onContentChange(e.target.value)}
            placeholder={`## Section header

This is the agreement between Stories by Victoria and {couple_first_names} for the wedding on {wedding_date_long} at {venue_name}.

**Bold text** for emphasis.`}
            className="w-full min-h-[400px] p-4 bg-background-alt/40 border border-border rounded-md text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/20 resize-y"
          />
          <p className="text-xs text-muted-foreground mt-2">
            Markdown formatting supported. Use placeholders like{" "}
            <code className="text-gold">{"{couple_first_names}"}</code> or{" "}
            <code className="text-gold">{"{wedding_date_long}"}</code> — they fill in when sent.
          </p>
          <details className="mt-2">
            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-primary">
              All placeholders
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
              {PLACEHOLDER_LIST.map((p) => (
                <code key={p} className="text-gold">{`{${p}}`}</code>
              ))}
            </div>
          </details>
        </div>
      </div>

      <div className="lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
          Preview {previewContext ? "" : "— sample data"}
        </p>
        <div className="bg-background-alt/30 border border-gold/30 rounded-md p-6">
          <div className="prose prose-sm max-w-none font-serif text-foreground">
            {rendered.trim() ? (
              <ReactMarkdown>{rendered}</ReactMarkdown>
            ) : (
              <p className="text-muted-foreground italic">Start writing — the preview will appear here.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
