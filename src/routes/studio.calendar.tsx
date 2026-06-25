import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ComingSoonPanel } from "@/components/ComingSoonPanel";
import { useAuth } from "@/lib/auth";
import { ChevronLeft, ChevronRight, Plus, Video } from "lucide-react";
import {
  getOwnerAvailability,
  createOwnerCalendarEvent,
  type OwnerAvailabilityResponse,
} from "@/lib/scheduling/dashboard.functions";

export const Route = createFileRoute("/studio/calendar")({
  component: AvailabilityDashboardPage,
});

const MS_DAY = 86_400_000;
const PIXELS_PER_HOUR = 36;
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 22;

function startOfWeekUtc(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  x.setUTCDate(x.getUTCDate() - x.getUTCDay());
  return x;
}

function fmtDayLabel(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(d);
}

function fmtTime(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function tzYmd(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
  return parts; // YYYY-MM-DD
}

function tzMinutesFromMidnight(iso: string, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return h * 60 + m;
}

function dayYmd(d: Date, tz: string): string {
  return tzYmd(d.toISOString(), tz);
}

function tzWeekdayFromYmd(ymd: string, tz: string): number {
  // Date-only string interpreted as local noon in tz.
  const [y, m, d] = ymd.split("-").map((n) => Number(n));
  const noonUtc = Date.UTC(y, m - 1, d, 17, 0); // ~noon ET
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(
    new Date(noonUtc),
  );
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[wd] ?? 0;
}

type Layoutable = { startUtc: string; endUtc: string };

/** Clip an interval to a single tz-local day; return null if no overlap. */
function clipToDay(
  ev: Layoutable,
  dayYmdStr: string,
  tz: string,
): { startMin: number; endMin: number } | null {
  const evStartYmd = tzYmd(ev.startUtc, tz);
  const evEndYmd = tzYmd(ev.endUtc, tz);
  if (dayYmdStr < evStartYmd || dayYmdStr > evEndYmd) return null;
  const startMin =
    dayYmdStr === evStartYmd ? tzMinutesFromMidnight(ev.startUtc, tz) : 0;
  const endMin =
    dayYmdStr === evEndYmd ? tzMinutesFromMidnight(ev.endUtc, tz) : 24 * 60;
  const clampedStart = Math.max(DAY_START_HOUR * 60, startMin);
  const clampedEnd = Math.min(DAY_END_HOUR * 60, endMin);
  if (clampedEnd <= clampedStart) return null;
  return { startMin: clampedStart, endMin: clampedEnd };
}

function AvailabilityDashboardPage() {
  const { profile } = useAuth();
  const role = profile?.role;

  if (!profile) return null;
  if (role !== "owner" && role !== "studio_manager") {
    return <ComingSoonPanel />;
  }

  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeekUtc(new Date()));
  const weekEnd = useMemo(() => new Date(weekStart.getTime() + 7 * MS_DAY), [weekStart]);
  const [addOpen, setAddOpen] = useState(false);

  const fetchFn = useServerFn(getOwnerAvailability);
  const queryClient = useQueryClient();
  const queryKey = ["owner-availability", weekStart.toISOString()];

  const { data, isLoading, isError, error } = useQuery({
    queryKey,
    queryFn: async (): Promise<OwnerAvailabilityResponse> => {
      const r = (await fetchFn({
        data: { fromIso: weekStart.toISOString(), toIso: weekEnd.toISOString() },
      })) as OwnerAvailabilityResponse;
      return r;
    },
  });

  const tz = data?.studioTimezone ?? "America/New_York";

  const days = useMemo(() => {
    const out: Date[] = [];
    for (let i = 0; i < 7; i++) out.push(new Date(weekStart.getTime() + i * MS_DAY));
    return out;
  }, [weekStart]);

  const hourMarkers = useMemo(() => {
    const out: number[] = [];
    for (let h = DAY_START_HOUR; h <= DAY_END_HOUR; h++) out.push(h);
    return out;
  }, []);

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-medium">Availability</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Calendars you mark "show titles" appear with their event names. Calendars
            marked private show as untitled "Busy (private)" blocks. Manage which
            calendars feed availability in Scheduling settings → Calendars.
          </p>
          {data && data.accountEmails.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              Connected accounts:{" "}
              <span className="font-mono">{data.accountEmails.join(", ")}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWeekStart(new Date(weekStart.getTime() - 7 * MS_DAY))}
          >
            <ChevronLeft size={16} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWeekStart(startOfWeekUtc(new Date()))}
          >
            This week
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWeekStart(new Date(weekStart.getTime() + 7 * MS_DAY))}
          >
            <ChevronRight size={16} />
          </Button>
          <Button
            size="sm"
            onClick={() => setAddOpen(true)}
            disabled={!data?.professional.connectionId}
          >
            <Plus size={14} className="mr-1" /> Add appointment
          </Button>
        </div>
      </header>

      {isError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          Couldn't load availability
          {error instanceof Error && error.message ? `: ${error.message}` : "."}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Week of {fmtDayLabel(days[0], tz)} — {tz}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading || !data ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="relative overflow-x-auto">
              <div className="grid grid-cols-[60px_repeat(7,1fr)] min-w-[800px] border-t border-l">
                <div className="border-b border-r bg-muted/40 h-10" />
                {days.map((d) => (
                  <div
                    key={d.toISOString()}
                    className="border-b border-r bg-muted/40 h-10 flex items-center justify-center text-xs font-medium"
                  >
                    {fmtDayLabel(d, tz)}
                  </div>
                ))}
                <div
                  className="border-r relative"
                  style={{ height: (DAY_END_HOUR - DAY_START_HOUR) * PIXELS_PER_HOUR }}
                >
                  {hourMarkers.map((h) => (
                    <div
                      key={h}
                      className="absolute left-0 right-0 text-[10px] text-muted-foreground pl-1"
                      style={{ top: (h - DAY_START_HOUR) * PIXELS_PER_HOUR - 6 }}
                    >
                      {h}:00
                    </div>
                  ))}
                </div>
                {days.map((d) => {
                  const ymd = dayYmd(d, tz);
                  const wd = tzWeekdayFromYmd(ymd, tz);
                  const isHoliday = data.holidays.includes(ymd);
                  const windowsToday = data.windows.filter((w) => w.weekdays.includes(wd));
                  const busyToday = data.busy.filter((b) => clipToDay(b, ymd, tz));
                  const profEventsToday = data.professionalEvents.filter((e) =>
                    clipToDay(e, ymd, tz),
                  );
                  const bookingsToday = data.bookings.filter((b) => clipToDay(b, ymd, tz));
                  return (
                    <div
                      key={d.toISOString()}
                      className="border-r border-b relative bg-background"
                      style={{ height: (DAY_END_HOUR - DAY_START_HOUR) * PIXELS_PER_HOUR }}
                    >
                      {hourMarkers.slice(1).map((h) => (
                        <div
                          key={h}
                          className="absolute left-0 right-0 border-t border-dashed border-muted-foreground/15"
                          style={{ top: (h - DAY_START_HOUR) * PIXELS_PER_HOUR }}
                        />
                      ))}
                      {!isHoliday &&
                        windowsToday.map((w, i) => {
                          const top =
                            ((w.startMinutes - DAY_START_HOUR * 60) / 60) * PIXELS_PER_HOUR;
                          const height =
                            ((w.endMinutes - w.startMinutes) / 60) * PIXELS_PER_HOUR;
                          return (
                            <div
                              key={i}
                              className="absolute left-0 right-0 bg-emerald-500/10"
                              style={{ top, height }}
                            />
                          );
                        })}
                      {isHoliday && (
                        <div className="absolute inset-0 bg-muted/40 flex items-center justify-center text-[10px] text-muted-foreground">
                          Holiday
                        </div>
                      )}
                      {/* Personal busy — private, untitled */}
                      {busyToday.map((b, i) => {
                        const c = clipToDay(b, ymd, tz)!;
                        const top = ((c.startMin - DAY_START_HOUR * 60) / 60) * PIXELS_PER_HOUR;
                        const height = ((c.endMin - c.startMin) / 60) * PIXELS_PER_HOUR;
                        return (
                          <div
                            key={`busy-${i}`}
                            title="Busy (private)"
                            className="absolute left-0.5 right-0.5 rounded-sm bg-slate-400/70 border border-slate-600/40"
                            style={{ top, height }}
                          />
                        );
                      })}
                      {/* Professional events — titled */}
                      {profEventsToday.map((ev) => {
                        const c = clipToDay(ev, ymd, tz)!;
                        const top = ((c.startMin - DAY_START_HOUR * 60) / 60) * PIXELS_PER_HOUR;
                        const height = ((c.endMin - c.startMin) / 60) * PIXELS_PER_HOUR;
                        return (
                          <div
                            key={`ev-${ev.id}`}
                            title={`${ev.title}${ev.location ? ` — ${ev.location}` : ""}`}
                            className="absolute left-0.5 right-0.5 rounded-sm bg-sky-600/85 border border-sky-900/50 text-[10px] text-white p-0.5 overflow-hidden"
                            style={{ top, height }}
                          >
                            <div className="font-medium truncate">{ev.title}</div>
                            {ev.location && (
                              <div className="opacity-90 truncate">{ev.location}</div>
                            )}
                          </div>
                        );
                      })}
                      {/* System bookings */}
                      {bookingsToday.map((b) => {
                        const c = clipToDay(b, ymd, tz)!;
                        const top = ((c.startMin - DAY_START_HOUR * 60) / 60) * PIXELS_PER_HOUR;
                        const height = ((c.endMin - c.startMin) / 60) * PIXELS_PER_HOUR;
                        return (
                          <div
                            key={`bk-${b.id}`}
                            title={`${b.callTypeName} — ${b.coupleName}`}
                            className="absolute left-0.5 right-0.5 rounded-sm bg-emerald-700/85 border border-emerald-900/50 text-[10px] text-white p-0.5 overflow-hidden"
                            style={{ top, height }}
                          >
                            <div className="font-medium truncate">{b.coupleName}</div>
                            <div className="opacity-90 truncate">{b.callTypeName}</div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-4 mt-4 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-sm bg-emerald-500/20 border border-emerald-500/30" />
                  Bookable window
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-sm bg-sky-600/85" />
                  Professional event
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-sm bg-slate-400/70" />
                  Personal busy (private)
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-sm bg-emerald-700/85" />
                  Booked call
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upcoming booked calls</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading || !data ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : data.bookings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No calls booked this week.</p>
          ) : (
            <ul className="divide-y">
              {data.bookings
                .slice()
                .sort((a, b) => a.startUtc.localeCompare(b.startUtc))
                .map((b) => (
                  <li
                    key={b.id}
                    className="py-2 flex items-center justify-between gap-4 text-sm"
                  >
                    <div>
                      <div className="font-medium">{b.coupleName}</div>
                      <div className="text-xs text-muted-foreground">
                        {b.callTypeName} · {fmtDayLabel(new Date(b.startUtc), tz)} ·{" "}
                        {fmtTime(new Date(b.startUtc), tz)} –{" "}
                        {fmtTime(new Date(b.endUtc), tz)}
                      </div>
                    </div>
                    {b.zoomJoinUrl && (
                      <a
                        href={b.zoomJoinUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <Video size={12} /> Join
                      </a>
                    )}
                  </li>
                ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <AddAppointmentDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        tz={tz}
        professionalEmail={data?.professional.accountEmail ?? null}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey });
        }}
      />
    </div>
  );
}

function AddAppointmentDialog({
  open,
  onOpenChange,
  tz,
  professionalEmail,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tz: string;
  professionalEmail: string | null;
  onSaved: () => void;
}) {
  const create = useServerFn(createOwnerCalendarEvent);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState("09:00");
  const [duration, setDuration] = useState(60);
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  function reset() {
    setTitle("");
    setLocation("");
    setNotes("");
  }

  async function submit() {
    if (!title.trim()) {
      toast.error("Title required");
      return;
    }
    setSaving(true);
    try {
      // Interpret date+time as wall-clock in studio tz, convert to UTC.
      const [y, m, d] = date.split("-").map(Number);
      const [hh, mm] = startTime.split(":").map(Number);
      // Compute the offset for that wall clock in tz by formatting back.
      let guess = Date.UTC(y, m - 1, d, hh, mm);
      // Adjust to tz: find offset by formatting
      const off = (() => {
        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          hourCycle: "h23",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        }).formatToParts(new Date(guess));
        const obj = Object.fromEntries(
          parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
        ) as Record<string, string>;
        const asUtc = Date.UTC(
          +obj.year,
          +obj.month - 1,
          +obj.day,
          +obj.hour,
          +obj.minute,
        );
        return Math.round((asUtc - guess) / 60000);
      })();
      const startMs = guess - off * 60000;
      const endMs = startMs + duration * 60_000;

      const res = await create({
        data: {
          title: title.trim(),
          startUtcIso: new Date(startMs).toISOString(),
          endUtcIso: new Date(endMs).toISOString(),
          location: location.trim() || null,
          notes: notes.trim() || null,
        },
      });
      toast.success(`Added to ${res.accountEmail ?? "professional calendar"}`);
      reset();
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add event");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add appointment</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">
          Writes to the professional calendar
          {professionalEmail && (
            <>
              {" "}
              (<span className="font-mono">{professionalEmail}</span>)
            </>
          )}
          . Never writes to the personal calendar.
        </p>
        <div className="space-y-3 mt-3">
          <div>
            <Label htmlFor="ev-title">Title</Label>
            <Input
              id="ev-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Lunch with Sarah"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="ev-date">Date</Label>
              <Input
                id="ev-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="ev-start">Start</Label>
              <Input
                id="ev-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="ev-dur">Duration (min)</Label>
              <Input
                id="ev-dur"
                type="number"
                min={5}
                step={5}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value) || 0)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="ev-loc">Location (optional)</Label>
            <Input
              id="ev-loc"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="ev-notes">Notes (optional)</Label>
            <Textarea
              id="ev-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Adding…" : "Add to calendar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
