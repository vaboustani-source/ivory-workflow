// Public confirmation page (Slice 4).
//   /book/confirmed/$cancel_token
// Reads via SECURITY DEFINER RPC get_booking_by_cancel_token (anon-callable).
// Safe projection only — no internal/owner fields exposed to the page.

import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const loadConfirmation = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) =>
    z.object({ token: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc("get_booking_by_cancel_token", {
      p_token: data.token,
    });
    if (error) throw error;
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) return null;
    return row;
  });

export const Route = createFileRoute("/book/confirmed/$cancel_token")({
  loader: async ({ params }) => {
    const data = await loadConfirmation({ data: { token: params.cancel_token } });
    if (!data) throw notFound();
    return data;
  },
  head: () => ({
    meta: [
      { title: "You're booked — Stories by Victoria" },
      { name: "robots", content: "noindex" },
    ],
    links: [
      {
        rel: "stylesheet",
        href:
          "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Jost:wght@300;400;500;600&display=swap",
      },
    ],
  }),
  notFoundComponent: () => (
    <Shell>
      <div className="py-24 text-center">
        <h1 className="font-serif text-4xl text-[#6B1F2A]">Not found</h1>
        <p className="mt-3 text-[#1a0a10]/70">This confirmation link isn't valid.</p>
      </div>
    </Shell>
  ),
  component: Confirmed,
});

function Shell({ children }: { children: React.ReactNode }) {
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
          <div className="text-[11px] uppercase tracking-[0.28em] text-[#6B1F2A]">
            Stories by Victoria
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-5 py-14">{children}</main>
      <footer className="border-t border-[#6B1F2A]/15">
        <div className="mx-auto max-w-2xl px-5 py-6 text-center text-xs text-[#1a0a10]/55">
          Stories by Victoria · Documentary wedding photography
        </div>
      </footer>
    </div>
  );
}

function Confirmed() {
  const b = Route.useLoaderData();
  const visitorTz = b.visitor_timezone ?? b.timezone_snapshot;
  const studioTz = b.timezone_snapshot;
  const fmtDate = (iso: string, tz: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(new Date(iso));
  const fmtTime = (iso: string, tz: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(iso));

  return (
    <Shell>
      <section className="text-center">
        <span className="inline-block rounded-full border border-[#B8924A]/50 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-[#B8924A]">
          Confirmed
        </span>
        <h1
          className="mt-5 text-[42px] leading-[1.05] text-[#6B1F2A] sm:text-[52px]"
          style={{ fontFamily: "'Cormorant Garamond', serif", fontWeight: 500 }}
        >
          You're booked.
        </h1>
        <p className="mx-auto mt-3 max-w-md text-[15px] text-[#1a0a10]/75">
          {b.couple_name_1}
          {b.couple_name_2 ? ` & ${b.couple_name_2}` : ""}, your{" "}
          {b.call_type_name.toLowerCase()} is set.
        </p>
      </section>

      <div className="mt-10 rounded-lg border border-[#6B1F2A]/15 bg-white p-6">
        <div className="text-[11px] uppercase tracking-[0.22em] text-[#B8924A]">When</div>
        <div
          className="mt-2 text-2xl text-[#6B1F2A]"
          style={{ fontFamily: "'Cormorant Garamond', serif" }}
        >
          {fmtDate(b.starts_at, visitorTz)}
        </div>
        <div className="mt-1 text-sm text-[#1a0a10]/80">
          {fmtTime(b.starts_at, visitorTz)} ({visitorTz}) · {b.duration_minutes} minutes
        </div>
        <div className="mt-0.5 text-xs text-[#1a0a10]/55">
          Studio time: {fmtTime(b.starts_at, studioTz)} ({studioTz})
        </div>

        {b.zoom_join_url ? (
          <div className="mt-6 border-t border-[#6B1F2A]/10 pt-5">
            <div className="text-[11px] uppercase tracking-[0.22em] text-[#B8924A]">
              Join on Zoom
            </div>
            <a
              href={b.zoom_join_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block break-all text-[15px] text-[#6B1F2A] underline decoration-[#B8924A]/60 underline-offset-4 hover:decoration-[#6B1F2A]"
            >
              {b.zoom_join_url}
            </a>
            {b.zoom_password ? (
              <div className="mt-2 text-sm text-[#1a0a10]/80">
                Password:{" "}
                <span className="rounded bg-[#6B1F2A]/5 px-1.5 py-0.5 font-mono text-[#6B1F2A]">
                  {b.zoom_password}
                </span>
              </div>
            ) : null}
            <div className="mt-4 text-sm text-[#1a0a10]/75">
              A calendar invite and confirmation email will arrive at{" "}
              <span className="text-[#1a0a10]">{b.primary_email}</span> shortly.
            </div>
          </div>
        ) : (
          <div className="mt-6 border-t border-[#6B1F2A]/10 pt-5 text-sm text-[#1a0a10]/75">
            A calendar invite and Zoom link will arrive at{" "}
            <span className="text-[#1a0a10]">{b.primary_email}</span> shortly.
          </div>
        )}
      </div>
    </Shell>
  );
}
