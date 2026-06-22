import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { ArrowLeft, Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { ComingSoonPanel } from "@/components/ComingSoonPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/studio/settings/scheduling/$id")({
  component: CallTypeDetailPage,
});

const FIELD_TYPES = ["text", "textarea", "email", "date", "dropdown", "checkbox"] as const;
type FieldType = (typeof FIELD_TYPES)[number];

const PIPELINE_STAGES = [
  { value: "new_inquiry", label: "New Inquiry" },
  { value: "discovery_call", label: "Discovery Call" },
  { value: "proposal_sent", label: "Proposal Sent" },
  { value: "contract_sent", label: "Contract Sent" },
  { value: "booked", label: "Booked" },
] as const;

const SYSTEM_FIELDS = [
  { label: "Primary email", type: "email", required: true },
  { label: "Couple name 1", type: "text", required: true },
  { label: "Couple name 2", type: "text", required: false },
  { label: "Phone", type: "text", required: false },
];

type CallType = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  color: string;
  pipeline_stage_on_book: string;
  is_active: boolean;
};

type Field = {
  id: string;
  call_type_id: string;
  label: string;
  field_type: FieldType;
  is_required: boolean;
  placeholder: string | null;
  options: string[] | null;
  display_order: number;
  field_key: string;
};

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function fieldKey(label: string) {
  return slugify(label).replace(/-/g, "_") || `field_${Math.random().toString(36).slice(2, 7)}`;
}

function CallTypeDetailPage() {
  const { profile } = useAuth();
  const { id } = Route.useParams();
  const navigate = useNavigate();

  const [ct, setCt] = useState<CallType | null>(null);
  const [fields, setFields] = useState<Field[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [{ data: ctRow, error: e1 }, { data: fRows, error: e2 }] = await Promise.all([
      supabase.from("call_types")
        .select("id, slug, name, description, duration_minutes, color, pipeline_stage_on_book, is_active")
        .eq("id", id).maybeSingle(),
      supabase.from("call_type_fields")
        .select("id, call_type_id, label, field_type, is_required, placeholder, options, display_order, field_key")
        .eq("call_type_id", id).order("display_order"),
    ]);
    if (e1) toast.error(e1.message);
    if (e2) toast.error(e2.message);
    setCt(ctRow as CallType | null);
    setFields(((fRows ?? []) as unknown as Field[]).map((f) => ({
      ...f,
      options: Array.isArray(f.options) ? (f.options as string[]) : null,
    })));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (!profile) return null;
  if (profile.role !== "owner") return <ComingSoonPanel />;
  if (!ct) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const saveCallType = async () => {
    setSaving(true);
    const { error } = await supabase.from("call_types").update({
      name: ct.name,
      slug: ct.slug,
      description: ct.description,
      duration_minutes: ct.duration_minutes,
      color: ct.color,
      pipeline_stage_on_book: ct.pipeline_stage_on_book,
      is_active: ct.is_active,
    }).eq("id", ct.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Saved");
  };

  const addField = async () => {
    const order = fields.length ? Math.max(...fields.map((f) => f.display_order)) + 1 : 1;
    const baseLabel = "New field";
    let key = fieldKey(baseLabel);
    let i = 1;
    while (fields.some((f) => f.field_key === key)) { key = `${fieldKey(baseLabel)}_${i++}`; }
    const { error } = await supabase.from("call_type_fields").insert({
      call_type_id: ct.id,
      label: baseLabel,
      field_type: "text",
      is_required: false,
      display_order: order,
      field_key: key,
    } as never);
    if (error) return toast.error(error.message);
    await load();
  };

  const updateField = async (f: Field, patch: Partial<Field>) => {
    const merged = { ...f, ...patch };
    const { error } = await supabase
      .from("call_type_fields")
      .update(patch as never)
      .eq("id", f.id);
    if (error) return toast.error(error.message);
    setFields((cur) => cur.map((x) => x.id === f.id ? merged : x));
  };

  const removeField = async (f: Field) => {
    if (!confirm(`Delete field "${f.label}"?`)) return;
    const { error } = await supabase.from("call_type_fields").delete().eq("id", f.id);
    if (error) return toast.error(error.message);
    await load();
  };

  const moveField = async (f: Field, dir: -1 | 1) => {
    const idx = fields.findIndex((x) => x.id === f.id);
    const swap = fields[idx + dir];
    if (!swap) return;
    await supabase.from("call_type_fields").update({ display_order: swap.display_order }).eq("id", f.id);
    await supabase.from("call_type_fields").update({ display_order: f.display_order }).eq("id", swap.id);
    await load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link to="/studio/settings/scheduling">
          <Button variant="ghost" size="sm"><ArrowLeft className="size-4 mr-1" /> Back</Button>
        </Link>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Call type</CardTitle></CardHeader>
        <CardContent className="space-y-4 max-w-2xl">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Name</Label>
              <Input value={ct.name} onChange={(e) => setCt({ ...ct, name: e.target.value, slug: ct.slug || slugify(e.target.value) })} />
            </div>
            <div>
              <Label>Slug</Label>
              <Input value={ct.slug} onChange={(e) => setCt({ ...ct, slug: slugify(e.target.value) })} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Duration (min)</Label>
              <Input type="number" value={ct.duration_minutes} onChange={(e) => setCt({ ...ct, duration_minutes: parseInt(e.target.value || "0", 10) })} />
            </div>
            <div>
              <Label>Color</Label>
              <Input type="color" value={ct.color} onChange={(e) => setCt({ ...ct, color: e.target.value })} />
            </div>
            <div>
              <Label>Active</Label>
              <div className="pt-2"><Checkbox checked={ct.is_active} onCheckedChange={(v) => setCt({ ...ct, is_active: !!v })} /></div>
            </div>
          </div>
          <div>
            <Label>Pipeline stage on book</Label>
            <Select value={ct.pipeline_stage_on_book} onValueChange={(v) => setCt({ ...ct, pipeline_stage_on_book: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PIPELINE_STAGES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Description</Label>
            <Textarea rows={3} value={ct.description ?? ""} onChange={(e) => setCt({ ...ct, description: e.target.value })} />
          </div>
          <div className="flex justify-end">
            <Button onClick={saveCallType} disabled={saving}>{saving ? "Saving…" : "Save call type"}</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">System fields</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            These fields are always present on every booking form and cannot be edited.
          </p>
          <ul className="space-y-1 text-sm">
            {SYSTEM_FIELDS.map((f) => (
              <li key={f.label} className="flex items-center gap-2">
                <span>{f.label}</span>
                <span className="text-xs text-muted-foreground">({f.type})</span>
                {f.required && <span className="text-xs text-destructive">*</span>}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Custom fields</CardTitle>
          <Button size="sm" onClick={addField}><Plus className="size-4 mr-1" />Add field</Button>
        </CardHeader>
        <CardContent>
          {fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">No custom fields. Add one above.</p>
          ) : (
            <ul className="space-y-3">
              {fields.map((f, i) => (
                <li key={f.id} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 grid grid-cols-2 gap-3">
                      <div>
                        <Label>Label</Label>
                        <Input
                          value={f.label}
                          onChange={(e) => setFields((cur) => cur.map((x) => x.id === f.id ? { ...x, label: e.target.value } : x))}
                          onBlur={(e) => updateField(f, { label: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label>Type</Label>
                        <Select value={f.field_type} onValueChange={(v) => updateField(f, { field_type: v as FieldType, options: v === "dropdown" ? (f.options ?? []) : null })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {FIELD_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Placeholder</Label>
                        <Input
                          value={f.placeholder ?? ""}
                          onChange={(e) => setFields((cur) => cur.map((x) => x.id === f.id ? { ...x, placeholder: e.target.value } : x))}
                          onBlur={(e) => updateField(f, { placeholder: e.target.value || null })}
                        />
                      </div>
                      <div className="flex items-end gap-2">
                        <Checkbox checked={f.is_required} onCheckedChange={(v) => updateField(f, { is_required: !!v })} />
                        <span className="text-sm">Required</span>
                      </div>
                      {f.field_type === "dropdown" && (
                        <div className="col-span-2">
                          <Label>Options (one per line)</Label>
                          <Textarea
                            rows={3}
                            value={(f.options ?? []).join("\n")}
                            onChange={(e) => {
                              const arr = e.target.value.split("\n").map((s) => s.trim()).filter(Boolean);
                              setFields((cur) => cur.map((x) => x.id === f.id ? { ...x, options: arr } : x));
                            }}
                            onBlur={(e) => {
                              const arr = e.target.value.split("\n").map((s) => s.trim()).filter(Boolean);
                              updateField(f, { options: arr });
                            }}
                          />
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1">
                      <Button variant="ghost" size="icon" disabled={i === 0} onClick={() => moveField(f, -1)} aria-label="Move up"><ArrowUp className="size-4" /></Button>
                      <Button variant="ghost" size="icon" disabled={i === fields.length - 1} onClick={() => moveField(f, 1)} aria-label="Move down"><ArrowDown className="size-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => removeField(f)} aria-label="Delete"><Trash2 className="size-4" /></Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">key: <code>{f.field_key}</code></p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
