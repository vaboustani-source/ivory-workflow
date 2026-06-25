import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, useCallback } from "react";
import { Plus, ArrowUp, ArrowDown, Copy, Eye, EyeOff, Pencil, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { ComingSoonPanel } from "@/components/ComingSoonPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  listGoogleCalendars,
  saveCalendarSelections,
  type ListGoogleCalendarsResponse,
  type CalendarEntry,
} from "@/lib/scheduling/calendars.functions";

export const Route = createFileRoute("/studio/settings/scheduling")({
  component: SchedulingSettingsPage,
});

type CallType = {
  id: string;
  slug: string;
  name: string;
  duration_minutes: number;
  color: string;
  is_active: boolean;
  display_order: number;
  pipeline_stage_on_book: string;
};

type SchedulingSettings = {
  id: string;
  timezone: string;
  buffer_minutes: number;
  min_lead_time_hours: number;
  lookahead_days: number;
  lookahead_days_raw?: string;
  primary_calendar_id: string | null;
  owner_notification_email: string | null;
};

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function SchedulingSettingsPage() {
  const { profile } = useAuth();
  if (!profile) return null;
  if (profile.role !== "owner") return <ComingSoonPanel />;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-medium">Scheduling</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure call types, availability, and global scheduling settings.
        </p>
      </header>
      <Tabs defaultValue="call-types">
        <TabsList>
          <TabsTrigger value="call-types">Call types</TabsTrigger>
          <TabsTrigger value="availability">Availability</TabsTrigger>
          <TabsTrigger value="calendars">Calendars</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="call-types" className="mt-6">
          <CallTypesTab />
        </TabsContent>
        <TabsContent value="availability" className="mt-6">
          <AvailabilityTab />
        </TabsContent>
        <TabsContent value="calendars" className="mt-6">
          <CalendarsTab />
        </TabsContent>
        <TabsContent value="settings" className="mt-6">
          <SettingsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CallTypesTab() {
  const [rows, setRows] = useState<CallType[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("call_types")
      .select("id, slug, name, duration_minutes, color, is_active, display_order, pipeline_stage_on_book")
      .order("display_order", { ascending: true });
    if (error) toast.error(error.message);
    setRows(((data ?? []) as CallType[]));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleActive = async (r: CallType) => {
    const { error } = await supabase.from("call_types").update({ is_active: !r.is_active }).eq("id", r.id);
    if (error) return toast.error(error.message);
    await load();
  };

  const move = async (r: CallType, dir: -1 | 1) => {
    const idx = rows.findIndex((x) => x.id === r.id);
    const swap = rows[idx + dir];
    if (!swap) return;
    await supabase.from("call_types").update({ display_order: swap.display_order }).eq("id", r.id);
    await supabase.from("call_types").update({ display_order: r.display_order }).eq("id", swap.id);
    await load();
  };

  const copyUrl = (slug: string) => {
    const url = `${window.location.origin}/book/${slug}`;
    navigator.clipboard.writeText(url);
    toast.success("Public URL copied", { description: url });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-4 mr-1" /> New call type
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No call types yet.</p>
          ) : (
            <ul className="divide-y">
              {rows.map((r, i) => (
                <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                  <span
                    aria-hidden
                    className="inline-block size-3 rounded-full"
                    style={{ background: r.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{r.name}</span>
                      {!r.is_active && <Badge variant="outline">Inactive</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      /{r.slug} · {r.duration_minutes} min · stage on book: {r.pipeline_stage_on_book.replace(/_/g, " ")}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" disabled={i === 0} onClick={() => move(r, -1)} aria-label="Move up">
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" disabled={i === rows.length - 1} onClick={() => move(r, 1)} aria-label="Move down">
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => copyUrl(r.slug)} aria-label="Copy public URL">
                    <Copy className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => toggleActive(r)} aria-label={r.is_active ? "Deactivate" : "Activate"}>
                    {r.is_active ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                  </Button>
                  <Link to="/studio/settings/scheduling/$id" params={{ id: r.id }}>
                    <Button variant="ghost" size="icon" aria-label="Edit">
                      <Pencil className="size-4" />
                    </Button>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {creating && (
        <NewCallTypeDialog
          existingMaxOrder={rows.length ? Math.max(...rows.map((r) => r.display_order)) : 0}
          onClose={() => setCreating(false)}
          onCreated={async () => { setCreating(false); await load(); }}
        />
      )}
    </div>
  )
}

function NewCallTypeDialog({
  existingMaxOrder,
  onClose,
  onCreated,
}: {
  existingMaxOrder: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [duration, setDuration] = useState(30);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return toast.error("Name required");
    setSaving(true);
    const slug = slugify(name);
    const { error } = await supabase.from("call_types").insert({
      name: name.trim(),
      slug,
      duration_minutes: duration,
      display_order: existingMaxOrder + 1,
    } as never);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Call type created");
    onCreated();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New call type</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Discovery Call" />
            <p className="text-xs text-muted-foreground mt-1">URL slug: /book/{slugify(name) || "your-slug"}</p>
          </div>
          <div>
            <Label>Duration (minutes)</Label>
            <Input
              type="number"
              min={5}
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value || "0", 10))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Creating…" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettingsTab() {
  const { profile } = useAuth();
  const [s, setS] = useState<SchedulingSettings | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    let { data, error } = await supabase
      .from("scheduling_settings")
      .select("id, timezone, buffer_minutes, min_lead_time_hours, lookahead_days, primary_calendar_id, owner_notification_email")
      .eq("owner_user_id", profile.id)
      .maybeSingle();
    if (error) toast.error(error.message);
    if (!data) {
      const ins = await supabase.from("scheduling_settings").insert({
        owner_user_id: profile.id,
      } as never).select().single();
      if (ins.error) { toast.error(ins.error.message); return; }
      data = ins.data as unknown as typeof data;
    }
    setS(data as SchedulingSettings);
  }, [profile]);

  useEffect(() => { load(); }, [load]);

  if (!s) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("scheduling_settings")
      .update({
        timezone: s.timezone,
        buffer_minutes: s.buffer_minutes,
        min_lead_time_hours: s.min_lead_time_hours,
        lookahead_days: s.lookahead_days,
        primary_calendar_id: s.primary_calendar_id,
        owner_notification_email: s.owner_notification_email,
      })
      .eq("id", s.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Saved");
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Global scheduling settings</CardTitle></CardHeader>
      <CardContent className="space-y-4 max-w-lg">
        <div>
          <Label>Timezone</Label>
          <Input value={s.timezone} onChange={(e) => setS({ ...s, timezone: e.target.value })} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label>Buffer (min)</Label>
            <Input type="number" value={s.buffer_minutes} onChange={(e) => setS({ ...s, buffer_minutes: parseInt(e.target.value || "0", 10) })} />
          </div>
          <div>
            <Label>Min lead (hours)</Label>
            <Input type="number" value={s.min_lead_time_hours} onChange={(e) => setS({ ...s, min_lead_time_hours: parseInt(e.target.value || "0", 10) })} />
          </div>
          <div>
            <Label>Lookahead (days)</Label>
            <Input type="number" value={s.lookahead_days} onChange={(e) => setS({ ...s, lookahead_days: parseInt(e.target.value || "0", 10) })} />
          </div>
        </div>
        <div>
          <Label>Primary Google calendar ID</Label>
          <Input value={s.primary_calendar_id ?? ""} onChange={(e) => setS({ ...s, primary_calendar_id: e.target.value || null })} placeholder="primary" />
        </div>
        <div>
          <Label>Owner notification email</Label>
          <Input value={s.owner_notification_email ?? ""} onChange={(e) => setS({ ...s, owner_notification_email: e.target.value || null })} />
        </div>
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Availability tab — minimal editor for calendar_availability_rules.
// One row = one weekly window. Days are 0=Sun..6=Sat to match JS getDay().
// The availability engine reads these same rows.
// ---------------------------------------------------------------------------

type AvailabilityRow = {
  id: string;
  user_id: string;
  event_type: "discovery_call" | "timeline_review" | "engagement_session_consultation" | "custom";
  available_days: number[];
  available_hours: { start: string; end: string };
  is_active: boolean;
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function AvailabilityTab() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<AvailabilityRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("calendar_availability_rules")
      .select("id, user_id, event_type, available_days, available_hours, is_active")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: true });
    if (error) toast.error(error.message);
    setRows(((data ?? []) as unknown) as AvailabilityRow[]);
    setLoading(false);
  }, [profile]);

  useEffect(() => { load(); }, [load]);

  const addRow = async () => {
    if (!profile) return;
    const { error } = await supabase.from("calendar_availability_rules").insert({
      user_id: profile.id,
      event_type: "custom",
      available_days: [2],
      available_hours: { start: "10:00", end: "15:00" },
      is_active: true,
    } as never);
    if (error) return toast.error(error.message);
    await load();
  };

  const updateRow = async (id: string, patch: Partial<AvailabilityRow>) => {
    const { error } = await supabase.from("calendar_availability_rules").update(patch as never).eq("id", id);
    if (error) return toast.error(error.message);
    await load();
  };

  const deleteRow = async (id: string) => {
    const { error } = await supabase.from("calendar_availability_rules").delete().eq("id", id);
    if (error) return toast.error(error.message);
    await load();
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Weekly windows</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Each row is one weekly window. Times are in your studio timezone (set in the Settings tab).
            The public booking pages walk these windows in 15-minute steps and only show starts where the
            full call still fits inside the window.
          </p>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No windows yet — add one below.</p>
          ) : (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 border rounded-sm p-3">
                  <div className="flex flex-wrap gap-1">
                    {DAY_LABELS.map((lbl, idx) => {
                      const on = r.available_days.includes(idx);
                      return (
                        <button
                          key={lbl}
                          type="button"
                          onClick={() => {
                            const next = on
                              ? r.available_days.filter((x) => x !== idx)
                              : [...r.available_days, idx].sort();
                            void updateRow(r.id, { available_days: next });
                          }}
                          className={`text-xs px-2 py-1 rounded-sm border ${on ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}
                        >
                          {lbl}
                        </button>
                      );
                    })}
                  </div>
                  <Input
                    type="time"
                    value={r.available_hours.start}
                    onChange={(e) => updateRow(r.id, { available_hours: { ...r.available_hours, start: e.target.value } })}
                    className="w-28"
                  />
                  <span className="text-sm text-muted-foreground">to</span>
                  <Input
                    type="time"
                    value={r.available_hours.end}
                    onChange={(e) => updateRow(r.id, { available_hours: { ...r.available_hours, end: e.target.value } })}
                    className="w-28"
                  />
                  <div className="flex-1" />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => updateRow(r.id, { is_active: !r.is_active })}
                  >
                    {r.is_active ? "Active" : "Inactive"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => deleteRow(r.id)}>
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div>
            <Button size="sm" onClick={addRow}>
              <Plus className="size-4 mr-1" /> Add window
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
