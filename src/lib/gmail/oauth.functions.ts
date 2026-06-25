// Per-user Gmail OAuth: start connect, disconnect, get current connection.
// Mirrors scheduling/integrations.functions.ts but scoped to gmail_accounts.
import { createServerFn } from "@tanstack/react-start";
import { setCookie, getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function originFromRequest(): string {
  const req = getRequest();
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

export type GmailAccountInfo = {
  connected: boolean;
  email: string | null;
  scopes: string[] | null;
  token_expires_at: string | null;
  updated_at: string | null;
  needs_reconnect: boolean;
};

export const startGmailOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const oauth = await import("@/lib/scheduling/oauth-config.server");
    const cfg = oauth.getProviderConfig("gmail");
    const nonce = oauth.makeNonce();
    const state = oauth.signState({ u: context.userId, n: nonce });
    const origin = originFromRequest();
    const redirectUri = `${origin}${oauth.callbackPath("gmail")}`;

    setCookie("lov_oauth_nonce_gmail", nonce, {
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

export const getGmailAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GmailAccountInfo> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("gmail_accounts")
      .select("email, scopes, token_expires_at, updated_at, is_active, refresh_token")
      .eq("user_id", context.userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) {
      return {
        connected: false, email: null, scopes: null,
        token_expires_at: null, updated_at: null, needs_reconnect: false,
      };
    }
    const r = data as {
      email: string | null;
      scopes: string[] | null;
      token_expires_at: string | null;
      updated_at: string | null;
      is_active: boolean;
      refresh_token: string | null;
    };
    return {
      connected: !!r.is_active,
      email: r.email,
      scopes: r.scopes,
      token_expires_at: r.token_expires_at,
      updated_at: r.updated_at,
      needs_reconnect: !r.is_active && !r.refresh_token,
    };
  });

export const disconnectGmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { revokeTokens } = await import("@/lib/scheduling/oauth-config.server");
    const { data: rows } = await supabaseAdmin
      .from("gmail_accounts")
      .select("id, access_token, refresh_token, email")
      .eq("user_id", context.userId)
      .eq("is_active", true);

    for (const row of rows ?? []) {
      const token =
        ((row.refresh_token as string | null) ?? null) ||
        ((row.access_token as string | null) ?? null);
      if (token) {
        try {
          await revokeTokens("gmail", token);
        } catch {
          // best-effort
        }
      }
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

      await supabaseAdmin.from("activity_log").insert({
        user_id: context.userId,
        action_type: "integration.disconnect",
        target_type: "gmail_account",
        description: `Disconnected Gmail${row.email ? ` (${row.email})` : ""}`,
        metadata: { provider: "gmail", account_email: row.email },
      });
    }
    return { ok: true, disconnected: (rows ?? []).length };
  });
