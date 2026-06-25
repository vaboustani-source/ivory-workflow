// Server-only: resolve the signed-in user's gmail_accounts row, refresh the
// access token when stale, and return an authed fetch wrapper for the Gmail
// REST API. Per-user, connection-aware: NEVER bare .maybeSingle() across
// all rows — always scoped to userId.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { refreshAccessToken } from "@/lib/scheduling/oauth-config.server";

export type GmailClient = {
  rowId: string;
  email: string | null;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
};

const REFRESH_SAFETY_WINDOW_MS = 60_000;
const GMAIL_API = "https://gmail.googleapis.com";

export async function getGmailClientForUser(userId: string): Promise<GmailClient> {
  // Per-user, single active row. If somehow multiple active rows exist for
  // the same user (multiple Gmail addresses), pick the most recently updated.
  const { data: rows, error } = await supabaseAdmin
    .from("gmail_accounts")
    .select("id, email, access_token, refresh_token, token_expires_at")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  const list = (rows ?? []) as Array<{
    id: string;
    email: string | null;
    access_token: string;
    refresh_token: string | null;
    token_expires_at: string | null;
  }>;
  if (list.length === 0) {
    throw new Error("gmail_not_connected");
  }
  const row = list[0];

  let accessToken = row.access_token;
  let refreshToken = row.refresh_token;
  let expiresAt = row.token_expires_at ? new Date(row.token_expires_at).getTime() : null;

  async function ensureFresh(force = false) {
    if (!refreshToken) return;
    const needs = force || !expiresAt || expiresAt - Date.now() < REFRESH_SAFETY_WINDOW_MS;
    if (!needs) return;
    try {
      const tok = await refreshAccessToken("gmail", refreshToken);
      accessToken = tok.access_token;
      if (tok.refresh_token) refreshToken = tok.refresh_token;
      expiresAt = Date.now() + tok.expires_in * 1000;
      await supabaseAdmin
        .from("gmail_accounts")
        .update({
          access_token: accessToken,
          refresh_token: refreshToken,
          token_expires_at: new Date(expiresAt).toISOString(),
        })
        .eq("id", row.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/invalid_grant/i.test(msg)) {
        await supabaseAdmin
          .from("gmail_accounts")
          .update({
            is_active: false,
            access_token: "",
            refresh_token: null,
            scopes: null,
            token_expires_at: null,
          })
          .eq("id", row.id);
        throw new Error("gmail_reconnect_required");
      }
      throw e;
    }
  }

  await ensureFresh();

  const wrappedFetch: GmailClient["fetch"] = async (url, init) => {
    const fullUrl = url.startsWith("http") ? url : `${GMAIL_API}${url}`;
    const doFetch = () =>
      fetch(fullUrl, {
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

  return { rowId: row.id, email: row.email, fetch: wrappedFetch };
}
