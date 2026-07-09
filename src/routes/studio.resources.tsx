import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { relativeTime } from "@/lib/dates";
import { ContractTemplateEditor } from "@/components/studio/ContractTemplateEditor";
import { Plus, Search, ArrowLeft, Eye, Trash2, Pencil } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { RESOURCE_PROSE_CSS } from "@/lib/resourceProseStyles";

export const Route = createFileRoute("/studio/resources")({
  component: StudioResources,
});

type Category = Database["public"]["Enums"]["resource_category"];
type ContentType = Database["public"]["Enums"]["resource_content_type"];

interface ResourceRow {
  id: string;
  title: string | null;
  slug: string | null;
  category: Category | null;
  content_type: ContentType | null;
  content: string | null;
  file_url: string | null;
  external_url: string | null;
  featured_image_url: string | null;
  excerpt: string | null;
  surface_in_stages: unknown;
  is_published: boolean | null;
  display_order: number | null;
  created_by: string | null;
  updated_at: string;
}

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "engagement_session", label: "Engagement session" },
  { value: "wedding_prep", label: "Wedding prep" },
  { value: "albums_prints", label: "Albums & prints" },
  { value: "faq", label: "FAQ" },
  { value: "style_guides", label: "Style guides" },
  { value: "travel_lodging", label: "Travel & lodging" },
  { value: "general", label: "General" },
];

const CONTENT_TYPES: { value: ContentType; label: string }[] = [
  { value: "article", label: "Article" },
  { value: "pdf", label: "PDF" },
  { value: "video", label: "Video" },
  { value: "link", label: "Link" },
];

const STAGES = ["inquiry", "engagement", "welcome", "booking", "planning", "pre_wedding", "post_wedding"] as const;
type Stage = typeof STAGES[number];

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function StudioResources() {
  const { profile, roles, user } = useAuth();
  const canManage = profile?.role === "owner" || roles.includes("studio_manager") || roles.includes("owner");

  const [rows, setRows] = useState<ResourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [publishedFilter, setPublishedFilter] = useState<"all" | "published" | "unpublished">("all");
  const [editing, setEditing] = useState<ResourceRow | "new" | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("resources")
      .select("id,title,slug,category,content_type,content,file_url,external_url,featured_image_url,excerpt,surface_in_stages,is_published,display_order,created_by,updated_at")
      .order("display_order", { ascending: true, nullsFirst: false })
      .order("updated_at", { ascending: false });
    if (error) toast.error(error.message);
    setRows((data ?? []) as ResourceRow[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const visible = useMemo(() => {
    return rows.filter((r) => {
      if (categoryFilter !== "all" && r.category !== categoryFilter) return false;
      if (publishedFilter === "published" && !r.is_published) return false;
      if (publishedFilter === "unpublished" && r.is_published) return false;
      if (search.trim() && !(r.title ?? "").toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [rows, categoryFilter, publishedFilter, search]);

  if (!canManage) {
    return (
      <div className="bg-surface rounded-lg shadow-soft p-8 border-t-2 border-gold">
        <p className="font-serif italic text-primary text-xl">Resources manager</p>
        <p className="text-sm text-muted-foreground mt-2">You don't have permission to manage resources.</p>
      </div>
    );
  }

  if (editing) {
    return (
      <ResourceEditor
        row={editing === "new" ? null : editing}
        userId={user?.id ?? null}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load(); }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="font-serif italic text-[28px] text-primary leading-tight">Resources</h1>
          <p className="text-sm text-muted-foreground mt-1">Guides, FAQs, and reference material for couples.</p>
        </div>
        <button
          onClick={() => setEditing("new")}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90"
        >
          <Plus size={14} /> New resource
        </button>
      </header>

      <div className="flex flex-col md:flex-row gap-2 md:items-center">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title…"
            className="w-full pl-8 pr-3 py-2 bg-surface border border-border rounded-md text-sm"
          />
        </div>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="px-3 py-2 bg-surface border border-border rounded-md text-sm">
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <select value={publishedFilter} onChange={(e) => setPublishedFilter(e.target.value as any)} className="px-3 py-2 bg-surface border border-border rounded-md text-sm">
          <option value="all">All states</option>
          <option value="published">Published</option>
          <option value="unpublished">Unpublished</option>
        </select>
      </div>

      {loading ? (
        <p className="font-serif italic text-primary p-8">Loading…</p>
      ) : visible.length === 0 ? (
        <div className="bg-surface rounded-lg shadow-soft py-16 text-center border-t-2 border-gold">
          <p className="font-serif italic text-2xl text-primary">No resources match.</p>
          <p className="text-sm text-muted-foreground mt-2">Adjust filters or create a new one.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((r) => (
            <div key={r.id} className="bg-surface rounded-lg shadow-soft border-t-2 border-gold p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-serif italic text-lg text-primary truncate">{r.title || "Untitled"}</h3>
                  {r.category && (
                    <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border bg-background-alt text-muted-foreground border-border">
                      {CATEGORIES.find(c => c.value === r.category)?.label ?? r.category}
                    </span>
                  )}
                  {r.content_type && (
                    <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border bg-plum/10 text-plum border-plum/30">
                      {r.content_type}
                    </span>
                  )}
                  {r.is_published ? (
                    <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border bg-sage/20 text-foreground border-sage/40">Published</span>
                  ) : (
                    <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border bg-background-alt text-muted-foreground border-border">Draft</span>
                  )}
                  <span className="text-[10px] text-muted-foreground">order {r.display_order ?? "—"}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Updated {relativeTime(r.updated_at)}</p>
              </div>
              <button onClick={() => setEditing(r)} className="text-xs px-2 py-1.5 rounded hover:bg-background-alt text-foreground inline-flex items-center gap-1"><Pencil size={12} /> Edit</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ResourceEditor({
  row, userId, onClose, onSaved,
}: { row: ResourceRow | null; userId: string | null; onClose: () => void; onSaved: () => void }) {
  const isNew = !row;
  const [title, setTitle] = useState(row?.title ?? "");
  const [slug, setSlug] = useState(row?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!!row?.slug);
  const [category, setCategory] = useState<Category>(row?.category ?? "general");
  const [contentType, setContentType] = useState<ContentType>(row?.content_type ?? "article");
  const [content, setContent] = useState(row?.content ?? "");
  const [fileUrl, setFileUrl] = useState(row?.file_url ?? "");
  const [externalUrl, setExternalUrl] = useState(row?.external_url ?? "");
  const [featuredImageUrl, setFeaturedImageUrl] = useState(row?.featured_image_url ?? "");
  const [excerpt, setExcerpt] = useState(row?.excerpt ?? "");
  const [stages, setStages] = useState<Stage[]>(() => {
    const s = row?.surface_in_stages;
    if (Array.isArray(s)) return s.filter((x): x is Stage => (STAGES as readonly string[]).includes(x));
    return [];
  });
  const [isPublished, setIsPublished] = useState<boolean>(row?.is_published ?? false);
  const [displayOrder, setDisplayOrder] = useState<number>(row?.display_order ?? 0);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const onTitleChange = (v: string) => {
    setTitle(v);
    if (!slugTouched) setSlug(slugify(v));
  };

  const toggleStage = (s: Stage) => {
    setStages((cur) => cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s]);
  };

  const save = async () => {
    if (!title.trim()) return toast.error("Title is required");
    setSaving(true);
    const payload = {
      title: title.trim(),
      slug: slug.trim() || slugify(title),
      category,
      content_type: contentType,
      content: content || null,
      file_url: fileUrl.trim() || null,
      external_url: externalUrl.trim() || null,
      featured_image_url: featuredImageUrl.trim() || null,
      excerpt: excerpt.trim() || null,
      surface_in_stages: stages as unknown as Database["public"]["Tables"]["resources"]["Insert"]["surface_in_stages"],
      is_published: isPublished,
      display_order: displayOrder,
      updated_at: new Date().toISOString(),
    };
    if (!row) {
      const { error } = await supabase.from("resources").insert({ ...payload, created_by: userId });
      setSaving(false);
      if (error) return toast.error(error.message);
      toast.success("Created");
      onSaved();
    } else {
      const { error } = await supabase.from("resources").update(payload).eq("id", row.id);
      setSaving(false);
      if (error) return toast.error(error.message);
      toast.success("Saved");
      onSaved();
    }
  };

  const doDelete = async () => {
    if (!row) return;
    if (!confirm(`Delete "${row.title}"? This cannot be undone.`)) return;
    setDeleting(true);
    const { error } = await supabase.from("resources").delete().eq("id", row.id);
    setDeleting(false);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    onSaved();
  };

  return (
    <div className="space-y-4">
      <button onClick={onClose} className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1">
        <ArrowLeft size={12} /> Back to resources
      </button>
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <h1 className="font-serif italic text-[28px] text-primary leading-tight">
          {isNew ? "New resource" : "Edit resource"}
        </h1>
        <div className="flex gap-2">
          <button onClick={() => setShowPreview((p) => !p)} className="text-sm text-foreground border border-border px-4 py-2 rounded-md inline-flex items-center gap-1 hover:bg-background-alt">
            <Eye size={14} /> {showPreview ? "Hide preview" : "Preview"}
          </button>
          {!isNew && (
            <button onClick={doDelete} disabled={deleting} className="text-sm text-magenta border border-magenta/40 px-4 py-2 rounded-md inline-flex items-center gap-1 hover:bg-magenta/10 disabled:opacity-50">
              <Trash2 size={14} /> Delete
            </button>
          )}
          <button onClick={onClose} className="text-sm text-muted-foreground px-4 py-2">Cancel</button>
          <button onClick={save} disabled={saving} className="bg-primary text-primary-foreground px-5 py-2 rounded-md text-sm hover:bg-primary/90 disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground block mb-2">Title <span className="text-magenta">*</span></label>
          <input value={title} onChange={(e) => onTitleChange(e.target.value)} className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm" />
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground block mb-2">Slug</label>
          <input value={slug} onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }} className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm font-mono" />
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground block mb-2">Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value as Category)} className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm">
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground block mb-2">Content type</label>
          <select value={contentType} onChange={(e) => setContentType(e.target.value as ContentType)} className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm">
            {CONTENT_TYPES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
      </div>

      {(contentType === "link" || contentType === "video") && (
        <div>
          <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground block mb-2">External URL</label>
          <input value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="https://…" className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm" />
        </div>
      )}
      {contentType === "pdf" && (
        <div>
          <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground block mb-2">File URL</label>
          <input value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} placeholder="https://…/file.pdf" className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm" />
        </div>
      )}

      <div>
        <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground block mb-2">Excerpt</label>
        <textarea value={excerpt} onChange={(e) => setExcerpt(e.target.value)} rows={2} className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm" />
      </div>

      <div>
        <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground block mb-2">Featured image URL</label>
        <input value={featuredImageUrl} onChange={(e) => setFeaturedImageUrl(e.target.value)} placeholder="https://…" className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm" />
      </div>

      <div>
        <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground block mb-2">Surface in stages</label>
        <div className="flex flex-wrap gap-2">
          {STAGES.map((s) => (
            <button key={s} type="button" onClick={() => toggleStage(s)}
              className={`text-xs px-3 py-1.5 rounded border ${stages.includes(s) ? "bg-primary text-primary-foreground border-primary" : "bg-surface text-foreground border-border hover:bg-background-alt"}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className="flex items-center gap-2 text-sm text-foreground bg-background-alt border border-border rounded-md px-3 py-2">
          <input type="checkbox" checked={isPublished} onChange={(e) => setIsPublished(e.target.checked)} />
          <span>Published (visible to couples)</span>
        </label>
        <div>
          <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground block mb-2">Display order</label>
          <input type="number" value={displayOrder} onChange={(e) => setDisplayOrder(parseInt(e.target.value || "0", 10))} className="w-full px-3 py-2 bg-surface border border-border rounded-md text-sm" />
        </div>
      </div>

      <div>
        <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground block mb-2">Content</label>
        <ContractTemplateEditor initialContent={content} templateType="other" onChange={setContent} />
      </div>

      {showPreview && (
        <div className="bg-surface border border-border rounded-lg p-6 shadow-soft">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-3">Preview (couple view)</p>
          {featuredImageUrl && (
            <img src={featuredImageUrl} alt={title} className="w-full max-h-64 object-cover rounded-md mb-4" />
          )}
          <h2 className="font-serif italic text-3xl text-primary mb-2">{title || "Untitled"}</h2>
          {excerpt && <p className="text-muted-foreground italic mb-4">{excerpt}</p>}
          {externalUrl && contentType !== "article" && (
            <p className="mb-4"><a href={externalUrl} target="_blank" rel="noreferrer" className="text-magenta underline">{externalUrl}</a></p>
          )}
          {fileUrl && contentType === "pdf" && (
            <p className="mb-4"><a href={fileUrl} target="_blank" rel="noreferrer" className="text-magenta underline">Download PDF</a></p>
          )}
          <div className="resource-prose" dangerouslySetInnerHTML={{ __html: content || "" }} />
          <style>{RESOURCE_PROSE_CSS}</style>
        </div>
      )}
    </div>
  );
}
