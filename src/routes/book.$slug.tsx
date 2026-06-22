// Public booking flow (Slice 4). Standalone brand page (no studio chrome).
//
// Loader fetches the active call type + ordered call_type_fields + studio
// timezone via supabaseAdmin. The page lets the visitor pick a date, then a
// time slot (in their tz, with studio tz subline), fill the form, review,
// and confirm. Submit hits /api/public/create-booking and redirects to
// /book/confirmed/<cancel_token>. 409 SLOT_TAKEN → refetch and repick.

import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";

// ---------- Loader server fn ----------

const loadBookingPage = createServerFn({ method: "GET" })
  .inputValidator((d: { slug: string }) =>
    z.object({ slug: z.string().min(1).max(80) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: callType, error: ctErr } = await supabaseAdmin
      .from("call_types")
      .select("id, slug, name, description, duration_minutes, color, is_active")
      .eq("slug", data.slug)
      .eq("is_active", true)
      .maybeSingle();
    if (ctErr) throw ctErr;
    if (!callType) return null;

    const { data: fields } = await supabaseAdmin
      .from("call_type_fields")
      .select("id, label, field_type, is_required, placeholder, options, display_order, field_key")
      .eq("call_type_id", callType.id)
      .order("display_order", { ascending: true });

    const { data: settings } = await supabaseAdmin
      .from("scheduling_settings")
      .select("timezone, lookahead_days")
      .limit(1)
      .maybeSingle();

    return {
      callType,
      fields: fields ?? [],
      studioTimezone: settings?.timezone ?? "America/New_York",
      lookaheadDays: settings?.lookahead_days ?? 60,
    };
  });

// ---------- Route ----------

export const Route = createFileRoute("/book/$slug")({
  loader: async ({ params }) => {
    const data = await loadBookingPage({ data: { slug: params.slug } });
    if (!data) throw notFound();
    return data;
  },
  head: ({ loaderData }) => {
    const name = loaderData?.callType?.name ?? "Book a call";
    return {
      meta: [
        { title: `${name} — Stories by Victoria` },
        { name: "description", content: `Schedule a ${name} with Victoria Boustani.` },
        { property: "og:title", content: `${name} — Stories by Victoria` },
        { property: "og:description", content: `Schedule a ${name} with Victoria Boustani.` },
        { name: "robots", content: "noindex" },
      ],
      links: [
        {
          rel: "stylesheet",
          href:
            "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Jost:wght@300;400;500;600&display=swap",
        },
      ],
    };
  },
  component: BookingPage,
  notFoundComponent: () => (
    <BrandShell>
      <div className="py-24 text-center">
        <h1 className="font-serif text-4xl text-[#6B1F2A]">Not found</h1>
        <p className="mt-3 text-[#1a0a10]/70">This call type isn't available.</p>
      </div>
    </BrandShell>
  ),
});

// ---------- Shared brand shell ----------

function BrandShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen w-full"
      style={{
        fontFamily: "'Jost', system-ui, sans-serif",
        background: "#F5EDE6",
        color: "#1a0a10",
      }}
    >
      <header className="border-b border-[#6B1F2A]/15">
        <div className="mx-auto max-w-2xl px-5 py-6 text-center">
          <div
            className="text-[11px] uppercase tracking-[0.28em] text-[#6B1F2A]"
            style={{ fontFamily: "'Jost', system-ui, sans-serif" }}
          >
            Stories by Victoria
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-5 py-10 sm:py-14">{children}</main>
      <footer className="border-t border-[#6B1F2A]/15">
        <div className="mx-auto max-w-2xl px-5 py-6 text-center text-xs text-[#1a0a10]/55">
          Stories by Victoria · Documentary wedding photography
        </div>
      </footer>
    </div>
  );
}

// ---------- Helpers ----------

type Slot = { startUtc: string; endUtc: string };
type FieldRow = {
  id: string;
  label: string;
  field_type: string;
  is_required: boolean | null;
  placeholder: string | null;
  options: unknown;
  display_order: number;
  field_key: string;
};

function detectTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch {
    return "America/New_York";
  }
}

function ymd(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function formatTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

function formatLongDate(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

function makeIdempotencyKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `k_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

// ---------- Booking page ----------

function BookingPage() {
  const { callType, fields, studioTimezone, lookaheadDays } = Route.useLoaderData();
  const navigate = useNavigate();
  const [visitorTz, setVisitorTz] = useState<string>(studioTimezone);
  useEffect(() => setVisitorTz(detectTz()), []);

  const [monthCursor, setMonthCursor] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() }; // 0-indexed month
  });
  const [allSlots, setAllSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);

  const [form, setForm] = useState({
    primary_email: "",
    couple_name_1: "",
    couple_name_2: "",
    phone: "",
    hp: "",
    custom: {} as Record<string, string | boolean>,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idemKey] = useState(() => makeIdempotencyKey());

  // Fetch all slots for the visible month + the rest of lookahead.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setSlotsLoading(true);
      const monthStart = new Date(Date.UTC(monthCursor.year, monthCursor.month, 1));
      const monthEnd = new Date(Date.UTC(monthCursor.year, monthCursor.month + 1, 1));
      const now = new Date();
      const from = monthStart < now ? now : monthStart;
      const horizon = new Date(now.getTime() + lookaheadDays * 86_400_000);
      const to = monthEnd > horizon ? horizon : monthEnd;
      if (to <= from) {
        setAllSlots([]);
        setSlotsLoading(false);
        return;
      }
      try {
        const url = `/api/public/availability?slug=${encodeURIComponent(callType.slug)}&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
        const res = await fetch(url);
        const json = (await res.json()) as { slots?: Slot[] };
        if (!cancelled) setAllSlots(json.slots ?? []);
      } catch {
        if (!cancelled) setAllSlots([]);
      } finally {
        if (!cancelled) setSlotsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [callType.slug, monthCursor.year, monthCursor.month, lookaheadDays]);

  const slotsByDate = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of allSlots) {
      const key = ymd(new Date(s.startUtc), visitorTz);
      const arr = map.get(key) ?? [];
      arr.push(s);
      map.set(key, arr);
    }
    return map;
  }, [allSlots, visitorTz]);

  const daySlots = selectedDate ? slotsByDate.get(selectedDate) ?? [] : [];

  function changeMonth(delta: number) {
    setSelectedDate(null);
    setSelectedSlot(null);
    setMonthCursor((c) => {
      const d = new Date(Date.UTC(c.year, c.month + delta, 1));
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
    });
  }

  async function refetchSlots() {
    // Re-trigger the loader by bumping a small dummy state — easiest is to call directly.
    const monthStart = new Date(Date.UTC(monthCursor.year, monthCursor.month, 1));
    const monthEnd = new Date(Date.UTC(monthCursor.year, monthCursor.month + 1, 1));
    const now = new Date();
    const from = monthStart < now ? now : monthStart;
    const horizon = new Date(now.getTime() + lookaheadDays * 86_400_000);
    const to = monthEnd > horizon ? horizon : monthEnd;
    try {
      const res = await fetch(
        `/api/public/availability?slug=${encodeURIComponent(callType.slug)}&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
      );
      const json = (await res.json()) as { slots?: Slot[] };
      setAllSlots(json.slots ?? []);
    } catch {
      /* ignore */
    }
  }

  async function submit() {
    setError(null);
    if (!selectedSlot) {
      setError("Pick a time first.");
      return;
    }
    if (!form.primary_email.trim() || !form.couple_name_1.trim()) {
      setError("Email and your name are required.");
      return;
    }
    for (const f of fields) {
      if (f.is_required) {
        const v = form.custom[f.field_key];
        if (f.field_type === "checkbox") {
          if (!v) {
            setError(`"${f.label}" is required.`);
            return;
          }
        } else if (!v || (typeof v === "string" && !v.trim())) {
          setError(`"${f.label}" is required.`);
          return;
        }
      }
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/public/create-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          call_type_id: callType.id,
          starts_at: selectedSlot.startUtc,
          primary_email: form.primary_email.trim(),
          couple_name_1: form.couple_name_1.trim(),
          couple_name_2: form.couple_name_2.trim() || undefined,
          phone: form.phone.trim() || undefined,
          custom_field_responses: form.custom,
          visitor_timezone: visitorTz,
          idempotency_key: idemKey,
          hp: form.hp,
        }),
      });
      if (res.status === 409) {
        setError("That time was just taken. Please pick another.");
        setSelectedSlot(null);
        await refetchSlots();
        setSubmitting(false);
        return;
      }
      if (!res.ok) {
        setError("Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }
      const json = (await res.json()) as { cancel_token: string };
      navigate({ to: "/book/confirmed/$cancel_token", params: { cancel_token: json.cancel_token } });
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  // Build month grid
  const monthDays = useMemo(() => {
    const first = new Date(Date.UTC(monthCursor.year, monthCursor.month, 1));
    const startWeekday = first.getUTCDay();
    const daysInMonth = new Date(
      Date.UTC(monthCursor.year, monthCursor.month + 1, 0),
    ).getUTCDate();
    const cells: Array<{ date: string | null; day: number | null }> = [];
    for (let i = 0; i < startWeekday; i++) cells.push({ date: null, day: null });
    for (let d = 1; d <= daysInMonth; d++) {
      const dateKey = `${monthCursor.year}-${String(monthCursor.month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push({ date: dateKey, day: d });
    }
    return cells;
  }, [monthCursor]);

  const monthLabel = new Date(Date.UTC(monthCursor.year, monthCursor.month, 1)).toLocaleString(
    "en-US",
    { month: "long", year: "numeric" },
  );

  return (
    <BrandShell>
      {/* Step 1: Header */}
      <section className="text-center">
        <span
          className="inline-block rounded-full border border-[#B8924A]/50 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-[#B8924A]"
        >
          {callType.duration_minutes} minutes · with Victoria
        </span>
        <h1
          className="mt-5 text-[42px] leading-[1.05] text-[#6B1F2A] sm:text-[52px]"
          style={{ fontFamily: "'Cormorant Garamond', serif", fontWeight: 500 }}
        >
          {callType.name}
        </h1>
        {callType.description ? (
          <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-[#1a0a10]/75">
            {callType.description}
          </p>
        ) : null}
      </section>

      {/* Step 2: Date picker */}
      <section className="mt-12">
        <SectionHeading>Select a date</SectionHeading>
        <div className="mt-5 rounded-lg border border-[#6B1F2A]/15 bg-white p-5">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => changeMonth(-1)}
              className="rounded px-2 py-1 text-sm text-[#6B1F2A] hover:bg-[#6B1F2A]/5"
            >
              ‹ Prev
            </button>
            <div className="text-sm uppercase tracking-[0.18em] text-[#1a0a10]/70">
              {monthLabel}
            </div>
            <button
              type="button"
              onClick={() => changeMonth(1)}
              className="rounded px-2 py-1 text-sm text-[#6B1F2A] hover:bg-[#6B1F2A]/5"
            >
              Next ›
            </button>
          </div>
          <div className="mt-4 grid grid-cols-7 gap-1 text-center text-[11px] uppercase tracking-wider text-[#1a0a10]/50">
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
              <div key={i} className="py-1">
                {d}
              </div>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {monthDays.map((c, i) => {
              if (!c.date) return <div key={i} />;
              const has = (slotsByDate.get(c.date) ?? []).length > 0;
              const isSel = selectedDate === c.date;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={!has}
                  onClick={() => {
                    setSelectedDate(c.date);
                    setSelectedSlot(null);
                  }}
                  className={[
                    "aspect-square rounded-md text-sm transition",
                    has
                      ? "bg-[#F5EDE6] text-[#6B1F2A] hover:bg-[#6B1F2A] hover:text-white"
                      : "text-[#1a0a10]/25 cursor-not-allowed",
                    isSel ? "bg-[#6B1F2A] text-white" : "",
                  ].join(" ")}
                >
                  {c.day}
                </button>
              );
            })}
          </div>
          {slotsLoading ? (
            <div className="mt-3 text-center text-xs text-[#1a0a10]/50">Loading availability…</div>
          ) : null}
        </div>
      </section>

      {/* Step 3: Time slots */}
      {selectedDate ? (
        <section className="mt-10">
          <SectionHeading>Select a time</SectionHeading>
          <p className="mt-2 text-xs text-[#1a0a10]/55">
            Times shown in {visitorTz}. Studio time: {studioTimezone}.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {daySlots.length === 0 ? (
              <div className="col-span-full rounded-md border border-dashed border-[#6B1F2A]/20 p-6 text-center text-sm text-[#1a0a10]/55">
                No times on this day.
              </div>
            ) : (
              daySlots.map((s) => {
                const sel = selectedSlot?.startUtc === s.startUtc;
                return (
                  <button
                    key={s.startUtc}
                    type="button"
                    onClick={() => setSelectedSlot(s)}
                    className={[
                      "rounded-md border px-3 py-2.5 text-sm transition",
                      sel
                        ? "border-[#6B1F2A] bg-[#6B1F2A] text-white"
                        : "border-[#6B1F2A]/20 bg-white text-[#1a0a10] hover:border-[#6B1F2A]",
                    ].join(" ")}
                  >
                    {formatTime(s.startUtc, visitorTz)}
                  </button>
                );
              })
            )}
          </div>
        </section>
      ) : null}

      {/* Step 4: Form */}
      {selectedSlot ? (
        <section className="mt-10">
          <SectionHeading>Your details</SectionHeading>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <FormField
              label="Email"
              required
              value={form.primary_email}
              onChange={(v) => setForm((f) => ({ ...f, primary_email: v }))}
              type="email"
            />
            <FormField
              label="Your name"
              required
              value={form.couple_name_1}
              onChange={(v) => setForm((f) => ({ ...f, couple_name_1: v }))}
            />
            <FormField
              label="Partner's name"
              value={form.couple_name_2}
              onChange={(v) => setForm((f) => ({ ...f, couple_name_2: v }))}
            />
            <FormField
              label="Phone"
              value={form.phone}
              onChange={(v) => setForm((f) => ({ ...f, phone: v }))}
              type="tel"
            />
          </div>
          {fields.length > 0 ? (
            <div className="mt-5 grid gap-4">
              {(fields as FieldRow[]).map((f) => (
                <CustomField
                  key={f.id}
                  field={f}
                  value={form.custom[f.field_key]}
                  onChange={(v) =>
                    setForm((s) => ({ ...s, custom: { ...s.custom, [f.field_key]: v } }))
                  }
                />
              ))}
            </div>
          ) : null}

          {/* Honeypot */}
          <div className="hidden" aria-hidden>
            <label>
              Leave this empty
              <input
                tabIndex={-1}
                autoComplete="off"
                value={form.hp}
                onChange={(e) => setForm((s) => ({ ...s, hp: e.target.value }))}
              />
            </label>
          </div>

          {/* Step 5: Review + Confirm */}
          <div className="mt-8 rounded-lg border border-[#6B1F2A]/15 bg-white p-5">
            <div className="text-[11px] uppercase tracking-[0.22em] text-[#B8924A]">Summary</div>
            <div
              className="mt-2 text-2xl text-[#6B1F2A]"
              style={{ fontFamily: "'Cormorant Garamond', serif" }}
            >
              {callType.name}
            </div>
            <div className="mt-1 text-sm text-[#1a0a10]/80">
              {formatLongDate(selectedSlot.startUtc, visitorTz)} ·{" "}
              {formatTime(selectedSlot.startUtc, visitorTz)} ({visitorTz})
            </div>
            <div className="mt-0.5 text-xs text-[#1a0a10]/55">
              Studio time: {formatTime(selectedSlot.startUtc, studioTimezone)} ({studioTimezone})
            </div>

            {error ? (
              <div className="mt-4 rounded border border-[#6B1F2A]/30 bg-[#6B1F2A]/5 p-3 text-sm text-[#6B1F2A]">
                {error}
              </div>
            ) : null}

            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="mt-5 w-full rounded-md bg-[#6B1F2A] px-5 py-3 text-sm uppercase tracking-[0.2em] text-white transition hover:bg-[#561821] disabled:opacity-60"
            >
              {submitting ? "Confirming…" : "Confirm booking"}
            </button>
          </div>
        </section>
      ) : null}
    </BrandShell>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="text-center text-[11px] uppercase tracking-[0.28em] text-[#B8924A]"
      style={{ fontFamily: "'Jost', system-ui, sans-serif" }}
    >
      {children}
    </h2>
  );
}

function FormField({
  label,
  value,
  onChange,
  required,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wider text-[#1a0a10]/65">
        {label}
        {required ? <span className="ml-1 text-[#6B1F2A]">*</span> : null}
      </span>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-[#6B1F2A]/20 bg-white px-3 py-2 text-sm text-[#1a0a10] outline-none focus:border-[#6B1F2A]"
      />
    </label>
  );
}

function CustomField({
  field,
  value,
  onChange,
}: {
  field: FieldRow;
  value: string | boolean | undefined;
  onChange: (v: string | boolean) => void;
}) {
  const labelEl = (
    <span className="block text-xs uppercase tracking-wider text-[#1a0a10]/65">
      {field.label}
      {field.is_required ? <span className="ml-1 text-[#6B1F2A]">*</span> : null}
    </span>
  );
  const inputCls =
    "mt-1 w-full rounded-md border border-[#6B1F2A]/20 bg-white px-3 py-2 text-sm text-[#1a0a10] outline-none focus:border-[#6B1F2A]";
  switch (field.field_type) {
    case "textarea":
      return (
        <label className="block">
          {labelEl}
          <textarea
            rows={4}
            placeholder={field.placeholder ?? ""}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            className={inputCls}
          />
        </label>
      );
    case "dropdown": {
      const opts = Array.isArray(field.options) ? (field.options as string[]) : [];
      return (
        <label className="block">
          {labelEl}
          <select
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            className={inputCls}
          >
            <option value="">Select…</option>
            {opts.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
      );
    }
    case "checkbox":
      return (
        <label className="flex items-center gap-2 text-sm text-[#1a0a10]">
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 accent-[#6B1F2A]"
          />
          <span>
            {field.label}
            {field.is_required ? <span className="ml-1 text-[#6B1F2A]">*</span> : null}
          </span>
        </label>
      );
    case "date":
      return (
        <label className="block">
          {labelEl}
          <input
            type="date"
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            className={inputCls}
          />
        </label>
      );
    case "email":
      return (
        <label className="block">
          {labelEl}
          <input
            type="email"
            placeholder={field.placeholder ?? ""}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            className={inputCls}
          />
        </label>
      );
    default:
      return (
        <label className="block">
          {labelEl}
          <input
            type="text"
            placeholder={field.placeholder ?? ""}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            className={inputCls}
          />
        </label>
      );
  }
}
