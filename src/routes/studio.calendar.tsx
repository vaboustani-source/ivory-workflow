import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ComingSoonPanel } from "@/components/ComingSoonPanel";
import { useAuth } from "@/lib/auth";
import { ChevronLeft, ChevronRight, Video } from "lucide-react";
import {
  getOwnerAvailability,
  type OwnerAvailabilityResponse,
} from "@/lib/scheduling/dashboard.functions";

export const Route = createFileRoute("/studio/calendar")({
  component: AvailabilityDashboardPage,
});

const MS_DAY = 86_400_000;
const PIXELS_PER_HOUR = 36; // 36px = 1h; row height
const DAY_START_HOUR = 7; // 7am
const DAY_END_HOUR = 22; // 10pm

function startOfWeekUtc(d: Date): Date {
  // Anchor to Sunday in *local-to-studio* sense by using UTC week boundary;
  // good enough for layout purposes — we render labels in the studio tz.
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

function tzMinutesFromMidnight(iso: string, tz: string): number {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return h * 60 + m;
}

function tzWeekday(iso: string, tz: string): number {
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  }).format(new Date(iso));
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[wd] ?? 0;
}

function AvailabilityDashboardPage() {
  const { profile } = useAuth();
  const role = profile?.role;

  if (!profile) return null;
  if (role !== "owner" && role !== "studio_manager") {
    return <ComingSoonPanel />;
  }

  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeekUtc(new Date()));
  const weekEnd = useMemo(
    () => new Date(weekStart.getTime() + 7 * MS_DAY),
    [weekStart],
  );

  const fetchFn = useServerFn(getOwnerAvailability);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["owner-availability", weekStart.toISOString()],
    queryFn: async (): Promise<OwnerAvailabilityResponse> => {
      const r = (await fetchFn({
        data: { fromIso: weekStart.toISOString(), toIso: weekEnd.toISOString() },
      })) as unknown;
      if (r && typeof r === "object" && "windows" in r) {
        return r as OwnerAvailabilityResponse;
      }
      throw new Error("Unexpected response");
    },
  });

  const tz = data?.studioTimezone ?? "America/New_York";

  const days = useMemo(() => {
    const out: Date[] = [];
    for (let i = 0; i < 7; i++) {
      out.push(new Date(weekStart.getTime() + i * MS_DAY));
    }
    return out;
  }, [weekStart]);

  const hourMarkers = useMemo(() => {
    const out: number[] = [];
    for (let h = DAY_START_HOUR; h <= DAY_END_HOUR; h++) out.push(h);
    return out;
  }, []);

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium">Availability</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Read-only view of when Victoria is free or busy across her connected
            Google calendars and booked calls. External event details are hidden.
          </p>
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
                {/* Header row */}
                <div className="border-b border-r bg-muted/40 h-10" />
                {days.map((d) => (
                  <div
                    key={d.toISOString()}
                    className="border-b border-r bg-muted/40 h-10 flex items-center justify-center text-xs font-medium"
                  >
                    {fmtDayLabel(d, tz)}
                  </div>
                ))}
                {/* Time gutter + day columns */}
                <div className="border-r relative" style={{ height: (DAY_END_HOUR - DAY_START_HOUR) * PIXELS_PER_HOUR }}>
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
                  const wd = d.getUTCDay();
                  const dayKey = d.toISOString().slice(0, 10);
                  const isHoliday = data.holidays.includes(dayKey);
                  // Window backdrop
                  const windowsToday = data.windows.filter((w) => w.weekdays.includes(wd));
                  // Busy + bookings intersecting this day
                  const dayStartIso = new Date(d.getTime()).toISOString();
                  const dayEndIso = new Date(d.getTime() + MS_DAY).toISOString();
                  const busyToday = data.busy.filter(
                    (b) => b.endUtc > dayStartIso && b.startUtc < dayEndIso,
                  );
                  const bookingsToday = data.bookings.filter(
                    (b) => b.endUtc > dayStartIso && b.startUtc < dayEndIso,
                  );
                  return (
                    <div
                      key={d.toISOString()}
                      className="border-r border-b relative bg-background"
                      style={{ height: (DAY_END_HOUR - DAY_START_HOUR) * PIXELS_PER_HOUR }}
                    >
                      {/* Hour grid lines */}
                      {hourMarkers.slice(1).map((h) => (
                        <div
                          key={h}
                          className="absolute left-0 right-0 border-t border-dashed border-muted-foreground/15"
                          style={{ top: (h - DAY_START_HOUR) * PIXELS_PER_HOUR }}
                        />
                      ))}
                      {/* Bookable windows backdrop */}
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
                      {/* Busy blocks (private — no titles) */}
                      {busyToday.map((b, i) => {
                        if (tzWeekday(b.startUtc, tz) !== wd && tzWeekday(b.endUtc, tz) !== wd) {
                          // overflow — keep simple, just clip
                        }
                        const startMin = Math.max(
                          DAY_START_HOUR * 60,
                          tzMinutesFromMidnight(b.startUtc, tz),
                        );
                        const endMin = Math.min(
                          DAY_END_HOUR * 60,
                          tzMinutesFromMidnight(b.endUtc, tz) || DAY_END_HOUR * 60,
                        );
                        if (endMin <= startMin) return null;
                        const top = ((startMin - DAY_START_HOUR * 60) / 60) * PIXELS_PER_HOUR;
                        const height = ((endMin - startMin) / 60) * PIXELS_PER_HOUR;
                        return (
                          <div
                            key={`busy-${i}`}
                            title="Busy"
                            className="absolute left-0.5 right-0.5 rounded-sm bg-slate-500/60 border border-slate-700/40"
                            style={{ top, height }}
                          />
                        );
                      })}
                      {/* Booked calls — our own data, OK to show titles */}
                      {bookingsToday.map((b) => {
                        const startMin = Math.max(
                          DAY_START_HOUR * 60,
                          tzMinutesFromMidnight(b.startUtc, tz),
                        );
                        const endMin = Math.min(
                          DAY_END_HOUR * 60,
                          tzMinutesFromMidnight(b.endUtc, tz) || DAY_END_HOUR * 60,
                        );
                        if (endMin <= startMin) return null;
                        const top = ((startMin - DAY_START_HOUR * 60) / 60) * PIXELS_PER_HOUR;
                        const height = ((endMin - startMin) / 60) * PIXELS_PER_HOUR;
                        return (
                          <div
                            key={`bk-${b.id}`}
                            title={`${b.callTypeName} — ${b.coupleName}`}
                            className="absolute left-0.5 right-0.5 rounded-sm bg-emerald-700/80 border border-emerald-900/40 text-[10px] text-white p-0.5 overflow-hidden"
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
                  <span className="inline-block w-3 h-3 rounded-sm bg-slate-500/60" />
                  Busy (private)
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-sm bg-emerald-700/80" />
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
                  <li key={b.id} className="py-2 flex items-center justify-between gap-4 text-sm">
                    <div>
                      <div className="font-medium">{b.coupleName}</div>
                      <div className="text-xs text-muted-foreground">
                        {b.callTypeName} · {fmtDayLabel(new Date(b.startUtc), tz)} ·{" "}
                        {fmtTime(new Date(b.startUtc), tz)} – {fmtTime(new Date(b.endUtc), tz)}
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
    </div>
  );
}
