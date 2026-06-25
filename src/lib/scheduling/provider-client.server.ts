// Server-only: read a calendar_connection row, refresh tokens if needed,
// and return a fetch wrapper that auto-retries once on 401.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { refreshAccessToken, type Provider } from "./oauth-config.server";

export type ProviderClient = {
  accountEmail: string | null;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
};

const REFRESH_SAFETY_WINDOW_MS = 60_000;

/**
 * Get a fetch-wrapper bound to a calendar connection.
 *
 * For Zoom: there is at most one active connection per user — passing
 * `connectionId` is optional.
 * For Google: a user can have MULTIPLE active connections (one per Google
 * account). Callers SHOULD pass `connectionId` to pick one. If omitted
 * and exactly one active row exists, that one is used; if multiple exist
 * we throw — callers must disambiguate.
 */
export async function getProviderClient(
  provider: Provider,
  userId: string,
  opts: { connectionId?: string } = {},
): Promise<ProviderClient> {
  let row: Record<string, unknown> | null = null;

  if (opts.connectionId) {
    // Explicit pick — id is unique, safe.
    const { data, error } = await supabaseAdmin
      .from("calendar_connections")
      .select("*")
      .eq("id", opts.connectionId)
      .eq("user_id", userId)
      .eq("provider", provider)
      .eq("is_active", true)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new Error(
        `No active ${provider} connection ${opts.connectionId} for user ${userId}`,
      );
    }
    row = data as Record<string, unknown>;
  } else {
    // Legacy 2-arg path. Multiple active rows are LEGAL (multi-account
    // Google). Never crash; pick deterministically:
    //   1) the row whose id == scheduling_settings.booking_calendar_connection_id
    //      (the professional / write target), if it's in the set
    //   2) otherwise the most-recently-updated active row
    const { data: rows, error } = await supabaseAdmin
      .from("calendar_connections")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", provider)
      .eq("is_active", true)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    const list = (rows ?? []) as Array<Record<string, unknown>>;
    if (list.length === 0) {
      throw new Error(`No active ${provider} connection for user ${userId}`);
    }
    if (list.length === 1) {
      row = list[0];
    } else {
      let preferredId: string | null = null;
      if (provider === "google") {
        const { data: s } = await supabaseAdmin
          .from("scheduling_settings")
          .select("booking_calendar_connection_id")
          .limit(1)
          .maybeSingle();
        preferredId =
          (s as { booking_calendar_connection_id?: string | null } | null)
            ?.booking_calendar_connection_id ?? null;
      }
      row =
        (preferredId && list.find((r) => r.id === preferredId)) || list[0];
    }
  }

  let accessToken: string = row.access_token as string;
  let refreshToken: string | null = (row.refresh_token as string | null) ?? null;
  let expiresAt: number | null = row.token_expires_at
    ? new Date(row.token_expires_at as string).getTime()
    : null;

  async function ensureFresh(force = false) {
    if (!refreshToken) return;
    const needs =
      force ||
      !expiresAt ||
      expiresAt - Date.now() < REFRESH_SAFETY_WINDOW_MS;
    if (!needs) return;
    try {
      const tok = await refreshAccessToken(provider, refreshToken);
      accessToken = tok.access_token;
      if (tok.refresh_token) refreshToken = tok.refresh_token;
      expiresAt = Date.now() + tok.expires_in * 1000;
      await supabaseAdmin
        .from("calendar_connections")
        .update({
          access_token: accessToken,
          refresh_token: refreshToken,
          token_expires_at: new Date(expiresAt).toISOString(),
        })
        .eq("id", row!.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/invalid_grant/i.test(msg)) {
        await supabaseAdmin
          .from("calendar_connections")
          .update({
            is_active: false,
            access_token: "",
            refresh_token: null,
            scopes: null,
            token_expires_at: null,
          })
          .eq("id", row!.id);
        await supabaseAdmin.from("activity_log").insert({
          user_id: userId,
          action_type: "integration.revoked",
          target_type: "calendar_connection",
          description: `${provider} connection revoked at provider; reconnect required`,
          metadata: { provider },
        });
        throw new Error(`${provider}_reconnect_required`);
      }
      throw e;
    }
  }

  await ensureFresh();

  const wrappedFetch: ProviderClient["fetch"] = async (url, init) => {
    const doFetch = () =>
      fetch(url, {
        ...init,
        headers: {
          ...(init?.headers ?? {}),
          Authorization: `Bearer ${accessToken}`,
        },
      });
    let res = await doFetch();
    if (res.status === 401) {
      await ensureFresh(true);
      res = await doFetch();
    }
    return res;
  };

  return {
    accountEmail: (row.account_email as string | null) ?? null,
    fetch: wrappedFetch,
  };
}

// ---------------------------------------------------------------------------
// Active-connection listing (multi-account aware). Use for Google fan-out.
// ---------------------------------------------------------------------------
export type ActiveConnectionRow = {
  id: string;
  provider: Provider;
  account_email: string | null;
  busy_calendar_ids: string[];
  calendar_id: string | null;
  updated_at: string | null;
  token_expires_at: string | null;
};

export async function listActiveConnections(
  provider: Provider,
  userId: string,
): Promise<ActiveConnectionRow[]> {
  const { data, error } = await supabaseAdmin
    .from("calendar_connections")
    .select("id, provider, account_email, busy_calendar_ids, calendar_id, updated_at, token_expires_at")
    .eq("user_id", userId)
    .eq("provider", provider)
    .eq("is_active", true)
    .order("updated_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    provider: r.provider as Provider,
    account_email: (r.account_email as string | null) ?? null,
    busy_calendar_ids: (r.busy_calendar_ids as string[] | null) ?? ["primary"],
    calendar_id: (r.calendar_id as string | null) ?? null,
    updated_at: (r.updated_at as string | null) ?? null,
    token_expires_at: (r.token_expires_at as string | null) ?? null,
  }));
}
