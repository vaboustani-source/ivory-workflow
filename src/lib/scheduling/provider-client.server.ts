// Server-only: read a calendar_connection row, refresh tokens if needed,
// and return a fetch wrapper that auto-retries once on 401.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { refreshAccessToken, type Provider } from "./oauth-config.server";

export type ProviderClient = {
  accountEmail: string | null;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
};

const REFRESH_SAFETY_WINDOW_MS = 60_000;

export async function getProviderClient(
  provider: Provider,
  userId: string,
): Promise<ProviderClient> {
  const { data: row, error } = await supabaseAdmin
    .from("calendar_connections")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", provider)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new Error(`No active ${provider} connection for user ${userId}`);

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
      .eq("id", row.id);
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
