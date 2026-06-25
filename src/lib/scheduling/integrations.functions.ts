import { createServerFn } from "@tanstack/react-start";
import { setCookie, getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const providerSchema = z.object({
  provider: z.enum(["google", "zoom"]),
});

const disconnectSchema = z.object({
  provider: z.enum(["google", "zoom"]),
  /** Required when disconnecting a specific Google account; ignored for Zoom. */
  connection_id: z.string().uuid().optional(),
});

const refreshSchema = z.object({
  provider: z.enum(["google", "zoom"]),
  connection_id: z.string().uuid().optional(),
});

function originFromRequest(): string {
  const req = getRequest();
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

export const startOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { provider: "google" | "zoom" }) =>
    providerSchema.parse(input),
  )
  .handler(async ({ data, context }) => {
    const { provider } = data;
    const { userId } = context;
    const oauth = await import("./oauth-config.server");
    const cfg = oauth.getProviderConfig(provider);
    const nonce = oauth.makeNonce();
    const state = oauth.signState({ u: userId, n: nonce });
    const origin = originFromRequest();
    const redirectUri = `${origin}${oauth.callbackPath(provider)}`;

    setCookie(`lov_oauth_nonce_${provider}`, nonce, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });

    const params = new URLSearchParams({
      client_id: cfg.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: cfg.scopes.join(" "),
      state,
      ...cfg.authorizeParams,
    });
    return { url: `${cfg.authorizeUrl}?${params.toString()}` };
  });

export const disconnectProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { provider: "google" | "zoom"; connection_id?: string }) =>
    disconnectSchema.parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { revokeTokens } = await import("./oauth-config.server");

    // Resolve rows to disconnect.
    let q = supabaseAdmin
      .from("calendar_connections")
      .select("id, access_token, refresh_token, account_email")
      .eq("user_id", context.userId)
      .eq("provider", data.provider)
      .eq("is_active", true);
    if (data.connection_id) q = q.eq("id", data.connection_id);
    const { data: rows } = await q;

    for (const row of rows ?? []) {
      const token =
        ((row.refresh_token as string | null) ?? null) ||
        ((row.access_token as string | null) ?? null);
      if (token) {
        try {
          await revokeTokens(data.provider, token);
        } catch {
          // best-effort revoke
        }
      }
      await supabaseAdmin
        .from("calendar_connections")
        .update({
          is_active: false,
          access_token: "",
          refresh_token: null,
          scopes: null,
          token_expires_at: null,
        })
        .eq("id", row.id);

      await supabaseAdmin.from("activity_log").insert({
        user_id: context.userId,
        action_type: "integration.disconnect",
        target_type: "calendar_connection",
        description: `Disconnected ${data.provider}${row.account_email ? ` (${row.account_email})` : ""}`,
        metadata: { provider: data.provider, account_email: row.account_email },
      });

      // If this was the booking write-target connection, clear the pointer.
      await supabaseAdmin
        .from("scheduling_settings")
        .update({ booking_calendar_connection_id: null })
        .eq("booking_calendar_connection_id", row.id);
    }

    return { ok: true, disconnected: (rows ?? []).length };
  });

export type ConnectionRow = {
  id: string;
  account_email: string | null;
  scopes: string[] | null;
  updated_at: string | null;
  token_expires_at: string | null;
  busy_calendar_ids: string[];
  is_booking_target: boolean;
};

export type IntegrationsList = {
  google: ConnectionRow[];
  /** Whether ANY google connection's refresh token is missing → reconnect required. */
  google_needs_reconnect: boolean;
  zoom: ConnectionRow | null;
  zoom_needs_reconnect: boolean;
};

export const listIntegrations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<IntegrationsList> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("calendar_connections")
      .select("id, provider, account_email, scopes, updated_at, token_expires_at, busy_calendar_ids, is_active, refresh_token")
      .eq("user_id", context.userId)
      .order("updated_at", { ascending: true });

    const { data: settings } = await supabaseAdmin
      .from("scheduling_settings")
      .select("booking_calendar_connection_id")
      .limit(1)
      .maybeSingle();
    const bookingTargetId =
      (settings as { booking_calendar_connection_id?: string | null } | null)
        ?.booking_calendar_connection_id ?? null;

    const rows = (data ?? []) as Array<{
      id: string;
      provider: "google" | "zoom";
      account_email: string | null;
      scopes: string[] | null;
      updated_at: string | null;
      token_expires_at: string | null;
      busy_calendar_ids: string[] | null;
      is_active: boolean;
      refresh_token: string | null;
    }>;

    const toRow = (r: typeof rows[number]): ConnectionRow => ({
      id: r.id,
      account_email: r.account_email,
      scopes: r.scopes,
      updated_at: r.updated_at,
      token_expires_at: r.token_expires_at,
      busy_calendar_ids: r.busy_calendar_ids ?? ["primary"],
      is_booking_target: r.id === bookingTargetId,
    });

    const googleActive = rows.filter((r) => r.provider === "google" && r.is_active);
    const googleAny = rows.filter((r) => r.provider === "google");
    const zoomActive = rows.find((r) => r.provider === "zoom" && r.is_active) ?? null;
    const zoomAny = rows.find((r) => r.provider === "zoom") ?? null;
    const googleAnyMostRecent = googleAny.length ? googleAny[googleAny.length - 1] : null;

    return {
      google: googleActive.map(toRow),
      google_needs_reconnect:
        googleActive.length === 0 && !!googleAnyMostRecent && !googleAnyMostRecent.refresh_token,
      zoom: zoomActive ? toRow(zoomActive) : null,
      zoom_needs_reconnect:
        !zoomActive && !!zoomAny && !zoomAny.refresh_token,
    };
  });

export const refreshIntegrationToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { provider: "google" | "zoom"; connection_id?: string }) =>
    refreshSchema.parse(input),
  )
  .handler(async ({ data, context }) => {
    const { getProviderClient } = await import("./provider-client.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("calendar_connections")
      .update({ token_expires_at: new Date(0).toISOString() })
      .eq("user_id", context.userId)
      .eq("provider", data.provider)
      .eq("is_active", true);
    if (data.connection_id) q = q.eq("id", data.connection_id);
    await q;
    const client = await getProviderClient(data.provider, context.userId, {
      connectionId: data.connection_id,
    });
    return { ok: true, account_email: client.accountEmail };
  });
