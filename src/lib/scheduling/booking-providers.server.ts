// Server-only: Zoom + Google Calendar provider integration for bookings (Slice 5).
// Uses the Slice-1 provider client (auto-refresh, fetch-based). Cloudflare-Workers safe.
//
// Public surface: runBookingProviderFlow() implements the saga in plan §4c/§9:
//   1. Pre-check both connections exist & active (else BookingProviderError 'no_connection').
//   2. Create Zoom meeting; on fail → throw.
//   3. Create Google event; on fail → best-effort delete Zoom meeting → throw.
//      If Zoom cleanup also fails, the error.orphanZoomMeetingId is set so the
//      caller can mention it in the owner alert.
//
// The caller is responsible for: deleting the booking row to free the slot,
// writing activity_log + notifications, returning 503 to the client.
//
// `invalid_grant` from the provider client (token revoked at provider) bubbles
// up as message including "_reconnect_required"; we surface it as
// reason='token_revoked' and the provider client has already marked the
// connection inactive.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getProviderClient } from "./provider-client.server";

export type ProviderFailureReason =
  | "no_connection"
  | "token_revoked"
  | "provider_error";

export class BookingProviderError extends Error {
  reason: ProviderFailureReason;
  provider: "google" | "zoom";
  detail: string;
  orphanZoomMeetingId: string | null;
  constructor(opts: {
    provider: "google" | "zoom";
    reason: ProviderFailureReason;
    detail: string;
    orphanZoomMeetingId?: string | null;
  }) {
    super(`[${opts.provider}] ${opts.reason}: ${opts.detail}`);
    this.provider = opts.provider;
    this.reason = opts.reason;
    this.detail = opts.detail;
    this.orphanZoomMeetingId = opts.orphanZoomMeetingId ?? null;
  }
}

export type BookingFlowInput = {
  ownerUserId: string;
  /** Calendar to write the event to (e.g. 'primary'). Falls back to 'primary'. */
  primaryCalendarId: string;
  /**
   * Which Google `calendar_connections` row to write the event to. When the
   * owner has multiple connected Google accounts, this MUST be set to
   * disambiguate. If null, the booking flow picks the single active Google
   * connection; if there are multiple, it errors.
   */
  bookingConnectionId: string | null;
  callTypeName: string;
  startUtcIso: string;
  endUtcIso: string;
  durationMinutes: number;
  studioTimezone: string;
  primaryEmail: string;
  coupleName1: string;
  coupleName2: string | null;
  phone: string | null;
  customFieldResponses: Record<string, unknown>;
  /** Optional inject points for testing the compensation branches. */
  __forceGoogleFail?: boolean;
  __forceZoomFail?: boolean;
};

export type BookingFlowResult = {
  zoom_meeting_id: string;
  zoom_join_url: string;
  zoom_password: string | null;
  google_calendar_event_id: string;
  google_calendar_id: string;
};

function isRevoked(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /_reconnect_required|invalid_grant/i.test(msg);
}

async function assertConnectionActive(
  supabaseAdmin: SupabaseClient,
  provider: "google" | "zoom",
  ownerUserId: string,
  opts: { connectionId?: string | null } = {},
): Promise<void> {
  let q = supabaseAdmin
    .from("calendar_connections")
    .select("id")
    .eq("user_id", ownerUserId)
    .eq("provider", provider)
    .eq("is_active", true);
  if (opts.connectionId) q = q.eq("id", opts.connectionId);
  const { data, error } = await q;
  if (error) {
    throw new BookingProviderError({
      provider,
      reason: "provider_error",
      detail: `connection lookup failed: ${error.message}`,
    });
  }
  if (!data || data.length === 0) {
    throw new BookingProviderError({
      provider,
      reason: "no_connection",
      detail: `no active ${provider} connection for owner`,
    });
  }
}

function describeCustomFields(custom: Record<string, unknown>): string {
  const keys = Object.keys(custom ?? {});
  if (keys.length === 0) return "";
  const lines = keys.map((k) => {
    const v = custom[k];
    const display = typeof v === "string" ? v : JSON.stringify(v);
    return `• ${k}: ${display}`;
  });
  return `\n\nResponses:\n${lines.join("\n")}`;
}

// ---------- Zoom ----------

async function createZoomMeeting(
  ownerUserId: string,
  input: BookingFlowInput,
): Promise<{ id: string; join_url: string; password: string | null }> {
  if (input.__forceZoomFail) {
    throw new BookingProviderError({
      provider: "zoom",
      reason: "provider_error",
      detail: "forced test failure",
    });
  }
  let client;
  try {
    client = await getProviderClient("zoom", ownerUserId);
  } catch (e) {
    if (isRevoked(e)) {
      throw new BookingProviderError({
        provider: "zoom",
        reason: "token_revoked",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
    throw new BookingProviderError({
      provider: "zoom",
      reason: "no_connection",
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  const couples = input.coupleName2
    ? `${input.coupleName1} & ${input.coupleName2}`
    : input.coupleName1;
  // Zoom expects start_time without trailing Z for "timezone" mode, but ISO
  // UTC ("...Z") is accepted and authoritative. Per Zoom API docs.
  const body = {
    topic: `${input.callTypeName} — ${couples}`,
    type: 2, // scheduled meeting
    start_time: input.startUtcIso,
    duration: input.durationMinutes,
    timezone: input.studioTimezone,
    settings: {
      join_before_host: false,
      waiting_room: true,
      mute_upon_entry: true,
      approval_type: 2, // no registration
      audio: "both",
      auto_recording: "none",
    },
  };
  const res = await client.fetch("https://api.zoom.us/v2/users/me/meetings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new BookingProviderError({
      provider: "zoom",
      reason: "provider_error",
      detail: `zoom create meeting ${res.status}: ${text.slice(0, 500)}`,
    });
  }
  const json = (await res.json()) as {
    id: number | string;
    join_url: string;
    password?: string;
  };
  return {
    id: String(json.id),
    join_url: json.join_url,
    password: json.password ?? null,
  };
}

async function deleteZoomMeeting(
  ownerUserId: string,
  meetingId: string,
): Promise<boolean> {
  try {
    const client = await getProviderClient("zoom", ownerUserId);
    const res = await client.fetch(
      `https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}`,
      { method: "DELETE" },
    );
    // 204 = deleted, 404 = already gone (treat as success).
    return res.ok || res.status === 404;
  } catch (e) {
    console.error("[scheduling] zoom delete cleanup failed:", e);
    return false;
  }
}

// ---------- Google ----------

async function createGoogleEvent(
  ownerUserId: string,
  input: BookingFlowInput,
  zoom: { join_url: string; password: string | null },
): Promise<{ event_id: string; calendar_id: string }> {
  if (input.__forceGoogleFail) {
    throw new BookingProviderError({
      provider: "google",
      reason: "provider_error",
      detail: "forced test failure",
    });
  }
  let client;
  try {
    client = await getProviderClient("google", ownerUserId, {
      connectionId: input.bookingConnectionId ?? undefined,
    });
  } catch (e) {
    if (isRevoked(e)) {
      throw new BookingProviderError({
        provider: "google",
        reason: "token_revoked",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
    throw new BookingProviderError({
      provider: "google",
      reason: "no_connection",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
  const calendarId = input.primaryCalendarId || "primary";
  const couples = input.coupleName2
    ? `${input.coupleName1} & ${input.coupleName2}`
    : input.coupleName1;

  const description =
    `Join Zoom: ${zoom.join_url}` +
    (zoom.password ? `\nPassword: ${zoom.password}` : "") +
    `\n\nWith: ${couples}\nEmail: ${input.primaryEmail}` +
    (input.phone ? `\nPhone: ${input.phone}` : "") +
    describeCustomFields(input.customFieldResponses);

  const body = {
    summary: `${input.callTypeName} — ${couples}`,
    description,
    location: zoom.join_url,
    start: { dateTime: input.startUtcIso, timeZone: "UTC" },
    end: { dateTime: input.endUtcIso, timeZone: "UTC" },
    attendees: [{ email: input.primaryEmail, displayName: couples }],
    reminders: { useDefault: true },
  };

  const url =
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events` +
    `?sendUpdates=none&conferenceDataVersion=0`;
  const res = await client.fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new BookingProviderError({
      provider: "google",
      reason: "provider_error",
      detail: `google create event ${res.status}: ${text.slice(0, 500)}`,
    });
  }
  const json = (await res.json()) as { id: string };
  return { event_id: json.id, calendar_id: calendarId };
}

// ---------- Orchestrator ----------

export async function runBookingProviderFlow(
  supabaseAdmin: SupabaseClient,
  input: BookingFlowInput,
): Promise<BookingFlowResult> {
  // Step 1: pre-check both connections.
  await assertConnectionActive(supabaseAdmin, "zoom", input.ownerUserId);
  await assertConnectionActive(supabaseAdmin, "google", input.ownerUserId);

  // Step 2: Zoom.
  const zoom = await createZoomMeeting(input.ownerUserId, input);

  // Step 3: Google — compensate Zoom on failure.
  let gcal: { event_id: string; calendar_id: string };
  try {
    gcal = await createGoogleEvent(input.ownerUserId, input, zoom);
  } catch (e) {
    const ok = await deleteZoomMeeting(input.ownerUserId, zoom.id);
    if (e instanceof BookingProviderError) {
      if (!ok) e.orphanZoomMeetingId = zoom.id;
      throw e;
    }
    throw new BookingProviderError({
      provider: "google",
      reason: "provider_error",
      detail: e instanceof Error ? e.message : String(e),
      orphanZoomMeetingId: ok ? null : zoom.id,
    });
  }

  return {
    zoom_meeting_id: zoom.id,
    zoom_join_url: zoom.join_url,
    zoom_password: zoom.password,
    google_calendar_event_id: gcal.event_id,
    google_calendar_id: gcal.calendar_id,
  };
}

// ---------- Owner alert helper ----------

export async function alertOwner(
  supabaseAdmin: SupabaseClient,
  ownerUserId: string,
  args: {
    title: string;
    body: string;
    actionType: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await supabaseAdmin.from("notifications").insert({
      user_id: ownerUserId,
      kind: "scheduling_alert",
      title: args.title,
      body: args.body,
      link_to: "/studio/settings/integrations",
    });
  } catch (e) {
    console.error("[scheduling] notifications insert failed:", e);
  }
  try {
    await supabaseAdmin.from("activity_log").insert({
      user_id: ownerUserId,
      action_type: args.actionType,
      target_type: "booking",
      description: args.title,
      metadata: (args.metadata ?? {}) as never,
    });
  } catch (e) {
    console.error("[scheduling] activity_log insert failed:", e);
  }
}
