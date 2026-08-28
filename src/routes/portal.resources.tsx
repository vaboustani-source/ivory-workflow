import { createFileRoute, useSearch, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PortalGate } from "@/components/PortalLayout";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Download,
  BookOpen,
  Heart,
  Sparkles,
  Camera,
  BookMarked,
  HelpCircle,
  Shirt,
  Plane,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { RESOURCE_PROSE_CSS } from "@/lib/resourceProseStyles";
import { substituteForClient } from "@/lib/mergeFields";

type SearchSchema = { slug?: string };

export const Route = createFileRoute("/portal/resources")({
  validateSearch: (s: Record<string, unknown>): SearchSchema => ({
    slug: typeof s.slug === "string" ? s.slug : undefined,
  }),
  component: () => (
    <PortalGate>{({ clientId, client }) => <PortalResources clientId={clientId} status={client.status} client={client} />}</PortalGate>
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
  style_guides: "Style Guides",
  albums_prints: "Albums & Prints",
  travel_lodging: "Travel & Lodging",
  faq: "Frequently Asked",
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

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  engagement_session: Heart,
  wedding_prep: Sparkles,
  style_guides: Shirt,
  albums_prints: BookMarked,
  travel_lodging: Plane,
  faq: HelpCircle,
  general: BookOpen,
};

function iconForCategory(cat: string | null | undefined): LucideIcon {
  if (!cat) return BookOpen;
  return CATEGORY_ICONS[cat] ?? BookOpen;
}

function stageForStatus(status: string | null | undefined): string | null {
  if (!status) return null;
  return status;
}

function PortalResources({ clientId, status, client }: { clientId: string; status: string | null; client: any }) {
  const search = useSearch({ from: "/portal/resources" });
  const navigate = useNavigate();
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);

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
    return <ResourceReader resource={openResource} client={client} onBack={() => navigate({ to: "/portal/resources", search: {} })} />;
  }

  return (
    <div className="pb-16">
      {/* Page header */}
      <header className="mb-14 max-w-3xl">
        <p className="text-[10px] uppercase tracking-[0.28em] text-gold mb-4">The Library</p>
        <h1 className="font-serif italic text-[44px] leading-[1.05] text-primary">Resources</h1>
        <p className="mt-5 text-[15px] text-foreground/70 leading-relaxed font-serif italic">
          Thoughtful guides, gentle checklists, and answered questions — gathered to help you
          plan with ease and savor every moment along the way.
        </p>
      </header>

      {resources.length === 0 ? (
        <div className="bg-surface rounded-lg shadow-soft p-16 text-center border-t-2 border-gold">
          <BookOpen className="mx-auto text-gold mb-4" size={32} />
          <p className="font-serif italic text-xl text-primary">No resources yet.</p>
          <p className="mt-2 text-sm text-muted-foreground">New pieces will appear here as we go.</p>
        </div>
      ) : (
        <div className="space-y-20">
          {grouped.map(({ category, items }) => {
            const Icon = iconForCategory(category);
            return (
              <section key={category}>
                <div className="mb-8 flex items-center gap-4">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[color-mix(in_oklab,_var(--gold)_18%,_transparent)]">
                      <Icon size={16} className="text-gold" strokeWidth={1.75} />
                    </span>
                    <h2 className="font-serif italic text-[26px] text-primary whitespace-nowrap">
                      {CATEGORY_LABELS[category] ?? category}
                    </h2>
                  </div>
                  <div className="h-px flex-1 bg-gradient-to-r from-[color-mix(in_oklab,_var(--gold)_55%,_transparent)] to-transparent" />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {items.map((r) => (
                    <ResourceCard
                      key={r.id}
                      resource={r}
                      onOpen={() => navigate({ to: "/portal/resources", search: { slug: r.slug ?? undefined } })}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ResourceCard({ resource, onOpen }: { resource: Resource; onOpen: () => void }) {
  const Icon = iconForCategory(resource.category);
  const hasImage = Boolean(resource.featured_image_url);

  return (
    <button
      onClick={onOpen}
      className="group relative text-left bg-surface rounded-xl overflow-hidden shadow-soft hover:shadow-elevated transition-all duration-300 flex flex-col hover:-translate-y-0.5"
    >
      {/* Gold top rule */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-gold to-transparent opacity-70"
      />

      {hasImage ? (
        <div className="aspect-[16/10] bg-background-alt overflow-hidden">
          <img
            src={resource.featured_image_url!}
            alt={resource.title ?? ""}
            className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-700"
            loading="lazy"
          />
        </div>
      ) : (
        <div className="relative aspect-[16/7] overflow-hidden bg-gradient-to-br from-background-alt via-background to-[color-mix(in_oklab,_var(--gold)_10%,_var(--background))]">
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-surface/80 backdrop-blur-sm ring-1 ring-[color-mix(in_oklab,_var(--gold)_40%,_transparent)] shadow-soft">
              <Icon size={22} className="text-gold" strokeWidth={1.5} />
            </span>
          </div>
          {/* subtle decorative flourish */}
          <span
            aria-hidden
            className="absolute -bottom-6 left-1/2 -translate-x-1/2 h-px w-24 bg-[color-mix(in_oklab,_var(--gold)_45%,_transparent)]"
          />
        </div>
      )}

      <div className="p-7 flex flex-col flex-1">
        <p className="text-[10px] uppercase tracking-[0.22em] text-gold mb-3">
          {CATEGORY_LABELS[resource.category ?? ""] ?? resource.category ?? ""}
          {resource.content_type && resource.content_type !== "article" && (
            <span className="text-muted-foreground/80 normal-case tracking-normal font-sans"> · {resource.content_type}</span>
          )}
        </p>
        <h3 className="font-serif text-[20px] leading-snug text-primary group-hover:text-magenta transition-colors">
          {resource.title}
        </h3>
        {resource.excerpt && (
          <p className="mt-3 text-[14px] text-foreground/70 leading-relaxed line-clamp-3 font-serif italic">
            {merged(resource.excerpt)}
          </p>
        )}
        <span className="mt-6 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.2em] text-primary/70 group-hover:text-magenta transition-colors">
          Read
          <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </button>
  );
}

function ResourceReader({ resource, client, onBack }: { resource: Resource; client: any; onBack: () => void }) {
  const merged = (t: string | null) => substituteForClient(t ?? "", client);
  return (
    <article className="max-w-[720px] mx-auto pt-6 pb-16">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-primary/60 hover:text-magenta transition-colors mb-10"
      >
        <ArrowLeft size={14} /> All resources
      </button>

      {resource.featured_image_url && (
        <div className="aspect-[16/9] rounded-xl overflow-hidden mb-12 shadow-soft">
          <img
            src={resource.featured_image_url}
            alt={resource.title ?? ""}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      <header className="mb-10 text-center">
        <p className="text-[10px] uppercase tracking-[0.28em] text-gold mb-5">
          {CATEGORY_LABELS[resource.category ?? ""] ?? resource.category ?? ""}
        </p>
        <h1 className="font-serif italic text-[42px] leading-[1.1] text-primary">{merged(resource.title)}</h1>
        {resource.excerpt && (
          <p className="mt-6 text-[18px] text-foreground/70 leading-relaxed font-serif italic max-w-[560px] mx-auto">
            {merged(resource.excerpt)}
          </p>
        )}
        <div className="mt-10 flex items-center justify-center gap-3" aria-hidden>
          <span className="h-px w-10 bg-[color-mix(in_oklab,_var(--gold)_55%,_transparent)]" />
          <span className="text-gold text-[10px] tracking-[0.4em]">✦</span>
          <span className="h-px w-10 bg-[color-mix(in_oklab,_var(--gold)_55%,_transparent)]" />
        </div>
      </header>

      {resource.content_type === "link" && resource.external_url && (
        <div className="mb-10 text-center">
          <a
            href={resource.external_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-primary text-background px-6 py-3 rounded-md text-[13px] tracking-wide hover:opacity-90 transition-opacity"
          >
            <ExternalLink size={15} /> Open link
          </a>
        </div>
      )}
      {resource.content_type === "video" && resource.external_url && (
        <div className="mb-10 text-center">
          <a
            href={resource.external_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-primary text-background px-6 py-3 rounded-md text-[13px] tracking-wide hover:opacity-90 transition-opacity"
          >
            <ExternalLink size={15} /> Watch video
          </a>
        </div>
      )}
      {resource.content_type === "pdf" && resource.file_url && (
        <div className="mb-10 text-center">
          <a
            href={resource.file_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-primary text-background px-6 py-3 rounded-md text-[13px] tracking-wide hover:opacity-90 transition-opacity"
          >
            <Download size={15} /> Download PDF
          </a>
        </div>
      )}

      {resource.content && (
        <div
          className="resource-prose"
          dangerouslySetInnerHTML={{ __html: merged(resource.content) }}
        />
      )}

      <div className="mt-16 flex items-center justify-center gap-3" aria-hidden>
        <span className="h-px w-16 bg-[color-mix(in_oklab,_var(--gold)_45%,_transparent)]" />
        <span className="text-gold text-[10px] tracking-[0.4em]">✦</span>
        <span className="h-px w-16 bg-[color-mix(in_oklab,_var(--gold)_45%,_transparent)]" />
      </div>

      <div className="mt-10 text-center">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-primary/60 hover:text-magenta transition-colors"
        >
          <ArrowLeft size={14} /> Back to all resources
        </button>
      </div>

      <style>{RESOURCE_PROSE_CSS}</style>
    </article>
  );
}
