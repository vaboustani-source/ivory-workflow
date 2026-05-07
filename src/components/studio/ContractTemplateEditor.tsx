import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect, useMemo, useState } from "react";
import { PlaceholderNode } from "./PlaceholderNode";
import { PLACEHOLDERS, type PlaceholderCategory, resolvePlaceholdersWithMarkers, SAMPLE_CONTEXT } from "@/lib/contractTemplating";
import { Bold, Italic, List, ListOrdered, Link as LinkIcon, Heading1, Heading2, Heading3, Eye, ChevronDown, X } from "lucide-react";

interface Props {
  initialContent: string;
  templateType: string;
  onChange: (html: string) => void;
}

const categoryLabel = (cat: PlaceholderCategory, templateType: string): string => {
  if (cat === "contractor") return "Contractor";
  if (cat === "studio") return "Studio";
  // couple
  return templateType === "contractor" ? "Couple" : "Client";
};

export function ContractTemplateEditor({ initialContent, templateType, onChange }: Props) {
  const [showPreview, setShowPreview] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, HTMLAttributes: { class: "text-magenta underline" } }),
      Placeholder.configure({ placeholder: "Start typing your contract..." }),
      PlaceholderNode,
    ],
    content: initialContent || "",
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none min-h-[400px] p-4 focus:outline-none",
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  useEffect(() => {
    if (editor && initialContent && editor.getHTML() !== initialContent) {
      editor.commands.setContent(initialContent || "", { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const insertPlaceholder = (key: string) => {
    if (!editor) return;
    editor.chain().focus().insertContent({ type: "placeholder", attrs: { key } }).run();
    setInsertOpen(false);
  };

  const filteredPlaceholders = useMemo(() => {
    return PLACEHOLDERS.filter((p) => {
      if (p.category === "contractor") return templateType === "contractor";
      return true;
    });
  }, [templateType]);

  const grouped = useMemo(() => {
    const m: Record<string, typeof PLACEHOLDERS> = {};
    for (const p of filteredPlaceholders) {
      (m[p.category] ??= []).push(p);
    }
    return m;
  }, [filteredPlaceholders]);

  const html = editor?.getHTML() ?? "";

  if (!editor) return null;

  const btn = (active: boolean, onClick: () => void, children: React.ReactNode, title: string) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded hover:bg-background-alt ${active ? "bg-background-alt text-primary" : "text-foreground"}`}
    >
      {children}
    </button>
  );

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-2">
          <div className="bg-surface border border-border rounded-md">
            <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
              {btn(editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), <Bold size={14} />, "Bold")}
              {btn(editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), <Italic size={14} />, "Italic")}
              <span className="w-px h-5 bg-border mx-1" />
              {btn(editor.isActive("heading", { level: 1 }), () => editor.chain().focus().toggleHeading({ level: 1 }).run(), <Heading1 size={14} />, "H1")}
              {btn(editor.isActive("heading", { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), <Heading2 size={14} />, "H2")}
              {btn(editor.isActive("heading", { level: 3 }), () => editor.chain().focus().toggleHeading({ level: 3 }).run(), <Heading3 size={14} />, "H3")}
              <span className="w-px h-5 bg-border mx-1" />
              {btn(editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run(), <List size={14} />, "Bullet list")}
              {btn(editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), <ListOrdered size={14} />, "Numbered list")}
              <span className="w-px h-5 bg-border mx-1" />
              {btn(editor.isActive("link"), () => {
                const prev = editor.getAttributes("link").href as string | undefined;
                const url = window.prompt("URL", prev ?? "https://");
                if (url === null) return;
                if (url === "") editor.chain().focus().unsetLink().run();
                else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
              }, <LinkIcon size={14} />, "Link")}
              <span className="w-px h-5 bg-border mx-1" />
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setInsertOpen((v) => !v)}
                  className="text-xs px-2 py-1 rounded hover:bg-background-alt inline-flex items-center gap-1"
                >
                  Insert placeholder <ChevronDown size={12} />
                </button>
                {insertOpen && (
                  <div className="absolute z-30 mt-1 w-72 max-h-80 overflow-y-auto bg-surface border border-border rounded-md shadow-elevated">
                    {Object.entries(grouped).map(([cat, items]) => (
                      <div key={cat} className="py-1">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground px-3 py-1">
                          {CATEGORY_LABELS[cat as PlaceholderCategory]}
                        </p>
                        {items.map((p) => (
                          <button
                            key={p.key}
                            type="button"
                            onClick={() => insertPlaceholder(p.key)}
                            className="w-full text-left px-3 py-1.5 text-xs hover:bg-background-alt"
                          >
                            <span className="font-mono text-gold">{p.token}</span>
                            <span className="text-muted-foreground ml-2">{p.description}</span>
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="ml-auto">
                <button
                  type="button"
                  onClick={() => setShowPreview(true)}
                  className="text-xs px-2 py-1 rounded border border-gold text-gold hover:bg-gold/10 inline-flex items-center gap-1"
                >
                  <Eye size={12} /> Preview with sample data
                </button>
              </div>
            </div>
            <EditorContent editor={editor} />
          </div>
        </div>
        <aside className="lg:col-span-1">
          <div className="bg-background-alt border border-border rounded-md p-4 sticky top-4">
            <h3 className="font-serif italic text-lg text-primary">Available placeholders</h3>
            <p className="text-xs text-muted-foreground mt-1 mb-3">Click any to insert at cursor.</p>
            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
              {Object.entries(grouped).map(([cat, items]) => (
                <div key={cat}>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                    {CATEGORY_LABELS[cat as PlaceholderCategory]}
                  </p>
                  <div className="space-y-1">
                    {items.map((p) => (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => insertPlaceholder(p.key)}
                        className="w-full text-left px-2 py-1.5 rounded hover:bg-surface border border-transparent hover:border-border transition-colors group"
                      >
                        <span className="inline-block text-[11px] font-mono text-gold bg-gold/10 px-1.5 py-0.5 rounded">
                          {p.token}
                        </span>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{p.description}</p>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {showPreview && (
        <div className="fixed inset-0 z-50 bg-plum/70 flex items-center justify-center p-4" onClick={() => setShowPreview(false)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-surface w-full max-w-3xl max-h-[90vh] flex flex-col rounded-lg shadow-elevated overflow-hidden">
            <div className="border-b border-gold/30 px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="font-serif italic text-xl text-primary">Preview with sample data</h2>
                <p className="text-xs text-muted-foreground">Placeholders resolved against fictional sample values.</p>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-xs text-muted-foreground inline-flex items-center gap-1">
                  <input type="checkbox" checked={showRaw} onChange={(e) => setShowRaw(e.target.checked)} /> Raw HTML
                </label>
                <button onClick={() => setShowPreview(false)} className="text-muted-foreground hover:text-magenta"><X size={20} /></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-6">
              {showRaw ? (
                <pre className="text-xs whitespace-pre-wrap font-mono text-foreground">{resolvePlaceholdersWithMarkers(html, SAMPLE_CONTEXT)}</pre>
              ) : (
                <div
                  className="prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: resolvePlaceholdersWithMarkers(html, SAMPLE_CONTEXT) }}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
