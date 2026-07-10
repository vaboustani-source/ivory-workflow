import { createFileRoute, useSearch, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PortalGate } from "@/components/PortalLayout";
import { ArrowLeft, ExternalLink, Download, BookOpen } from "lucide-react";
import { RESOURCE_PROSE_CSS } from "@/lib/resourceProseStyles";

type SearchSchema = { slug?: string };

export const Route = createFileRoute("/portal/resources")({
  validateSearch: (s: Record<string, unknown>): SearchSchema => ({
    slug: typeof s.slug === "string" ? s.slug : undefined,
  }),
  component: () => (
    <PortalGate>{({ clientId, client }) => <PortalResources clientId={clientId} status={client.status} />}</PortalGate>
  ),
});


interface Resource {
  id: string;
  slug: string | null;
  title: string | null;
  excerpt: string | null;
  content: string | null;
  content_type: string | null;
  category: string | null;
  featured_image_url: string | null;
  external_url: string | null;
  file_url: string | null;
  display_order: number | null;
  surface_in_stages: any;
}

const CATEGORY_LABELS: Record<string, string> = {
  engagement_session: "Engagement Session",
  wedding_prep: "Wedding Prep",
  albums_prints: "Albums & Prints",
  faq: "Frequently Asked",
  style_guides: "Style Guides",
  travel_lodging: "Travel & Lodging",
  general: "General",
};

const CATEGORY_ORDER = [
  "engagement_session",
  "wedding_prep",
  "style_guides",
  "albums_prints",
  "travel_lodging",
  "faq",
  "general",
];

function stageForStatus(status: string | null | undefined): string | null {
  if (!status) return null;
  // Best-effort mapping; safe fallback if unknown.
  return status;
}

function PortalResources({ clientId, status }: { clientId: string; status: string | null }) {
  const search = useSearch({ from: "/portal/resources" });
  const navigate = useNavigate();
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasEngagement, setHasEngagement] = useState<boolean>(false);

  useEffect(() => {
    (async () => {
      const [{ data }, { data: eng }] = await Promise.all([
        supabase
          .from("resources")
          .select("id, slug, title, excerpt, content, content_type, category, featured_image_url, external_url, file_url, display_order, surface_in_stages")
          .eq("is_published", true)
          .order("display_order", { ascending: true, nullsFirst: false })
          .order("title", { ascending: true }),
        supabase.rpc("client_has_engagement", { _client_id: clientId }),
      ]);
      const rows = (data ?? []) as Resource[];
      const engaged = Boolean(eng);
      setHasEngagement(engaged);
      setResources(engaged ? rows : rows.filter((r) => r.category !== "engagement_session"));
      setLoading(false);
    })();
  }, [clientId]);


  const currentStage = stageForStatus(status);

  const grouped = useMemo(() => {
    const byCat = new Map<string, Resource[]>();
    for (const r of resources) {
      const c = r.category || "general";
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c)!.push(r);
    }
    // Sort resources within a category: stage-matching first, then display_order/title
    for (const [c, list] of byCat) {
      list.sort((a, b) => {
        const aMatch = currentStage && Array.isArray(a.surface_in_stages) && a.surface_in_stages.includes(currentStage) ? 1 : 0;
        const bMatch = currentStage && Array.isArray(b.surface_in_stages) && b.surface_in_stages.includes(currentStage) ? 1 : 0;
        if (aMatch !== bMatch) return bMatch - aMatch;
        return 0;
      });
      byCat.set(c, list);
    }
    const cats = Array.from(byCat.keys()).sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a);
      const bi = CATEGORY_ORDER.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
    return cats.map((c) => ({ category: c, items: byCat.get(c)! }));
  }, [resources, currentStage]);

  const openResource = search.slug ? resources.find((r) => r.slug === search.slug) : null;

  if (loading) {
    return <p className="font-serif italic text-primary">Loading…</p>;
  }

  if (openResource) {
    return <ResourceReader resource={openResource} onBack={() => navigate({ to: "/portal/resources", search: {} })} />;
  }

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-serif italic text-[32px] text-primary">Resources</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Guides, checklists, and answers to help you plan with ease.
        </p>
      </header>

      {resources.length === 0 ? (
        <div className="bg-surface rounded-lg shadow-soft p-12 text-center border-t-2 border-gold">
          <BookOpen className="mx-auto text-gold mb-4" size={32} />
          <p className="font-serif italic text-xl text-primary">No resources yet.</p>
        </div>
      ) : (
        <div className="space-y-14">
          {grouped.map(({ category, items }) => (
            <section key={category}>
              <h2 className="font-serif italic text-[22px] text-primary mb-6">
                {CATEGORY_LABELS[category] ?? category}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {items.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => navigate({ to: "/portal/resources", search: { slug: r.slug ?? undefined } })}
                    className="text-left bg-surface rounded-lg shadow-soft border-t-2 border-gold overflow-hidden hover:shadow-elevated transition-shadow group"
                  >
                    {r.featured_image_url && (
                      <div className="aspect-[16/10] bg-background-alt overflow-hidden">
                        <img
                          src={r.featured_image_url}
                          alt={r.title ?? ""}
                          className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500"
                          loading="lazy"
                        />
                      </div>
                    )}
                    <div className="p-6">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] uppercase tracking-[0.15em] text-gold">
                          {CATEGORY_LABELS[r.category ?? ""] ?? r.category ?? ""}
                        </span>
                        {r.content_type && r.content_type !== "article" && (
                          <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                            · {r.content_type}
                          </span>
                        )}
                      </div>
                      <h3 className="font-serif text-lg text-primary leading-snug">{r.title}</h3>
                      {r.excerpt && (
                        <p className="mt-2 text-sm text-foreground/75 leading-relaxed line-clamp-3">
                          {r.excerpt}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function ResourceReader({ resource, onBack }: { resource: Resource; onBack: () => void }) {
  return (
    <article className="max-w-[720px] mx-auto py-10">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm text-primary/70 hover:text-magenta mb-6"
      >
        <ArrowLeft size={16} /> All resources
      </button>

      {resource.featured_image_url && (
        <div className="aspect-[16/9] rounded-lg overflow-hidden mb-8 shadow-soft">
          <img src={resource.featured_image_url} alt={resource.title ?? ""} className="w-full h-full object-cover" />
        </div>
      )}

      <div className="mb-8">
        <p className="text-[10px] uppercase tracking-[0.2em] text-gold mb-3">
          {CATEGORY_LABELS[resource.category ?? ""] ?? resource.category ?? ""}
        </p>
        <h1 className="font-serif italic text-[36px] leading-tight text-primary">{resource.title}</h1>
        {resource.excerpt && (
          <p className="mt-4 text-lg text-foreground/70 leading-relaxed font-serif italic">
            {resource.excerpt}
          </p>
        )}
      </div>

      {resource.content_type === "link" && resource.external_url && (
        <a
          href={resource.external_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 bg-primary text-background px-5 py-2.5 rounded-md text-sm mb-8 hover:opacity-90"
        >
          <ExternalLink size={16} /> Open link
        </a>
      )}
      {resource.content_type === "video" && resource.external_url && (
        <a
          href={resource.external_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 bg-primary text-background px-5 py-2.5 rounded-md text-sm mb-8 hover:opacity-90"
        >
          <ExternalLink size={16} /> Watch video
        </a>
      )}
      {resource.content_type === "pdf" && resource.file_url && (
        <a
          href={resource.file_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 bg-primary text-background px-5 py-2.5 rounded-md text-sm mb-8 hover:opacity-90"
        >
          <Download size={16} /> Download PDF
        </a>
      )}

      {resource.content && (
        <div
          className="resource-prose"
          dangerouslySetInnerHTML={{ __html: resource.content }}
        />
      )}

      <style>{RESOURCE_PROSE_CSS}</style>
    </article>
  );
}
