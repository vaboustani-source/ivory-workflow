import { createServerFn } from "@tanstack/react-start";
import { setCookie, getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const providerSchema = z.object({
  provider: z.enum(["google", "zoom"]),
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
  .inputValidator((input: { provider: "google" | "zoom" }) =>
    providerSchema.parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { revokeTokens } = await import("./oauth-config.server");

    const { data: row } = await supabaseAdmin
      .from("calendar_connections")
      .select("id, access_token, refresh_token")
      .eq("user_id", context.userId)
      .eq("provider", data.provider)
      .eq("is_active", true)
      .maybeSingle();

    if (row) {
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
      .eq("user_id", context.userId)
      .eq("provider", data.provider)
      .eq("is_active", true);

    await supabaseAdmin.from("activity_log").insert({
      user_id: context.userId,
      action_type: "integration.disconnect",
      target_type: "calendar_connection",
      description: `Disconnected ${data.provider}`,
      metadata: { provider: data.provider },
    });

    return { ok: true };
  });

export type IntegrationStatus = {
  provider: "google" | "zoom";
  connected: boolean;
  needs_reconnect: boolean;
  account_email: string | null;
  scopes: string[] | null;
  updated_at: string | null;
  token_expires_at: string | null;
};

export const listIntegrations = createServerFn({ method: "POST" }) // method must be POST — GET serverFns 405 in this runtime
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<IntegrationStatus[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("calendar_connections")
      .select("provider, account_email, scopes, updated_at, token_expires_at, is_active, refresh_token")
      .eq("user_id", context.userId)
      .order("updated_at", { ascending: false });

    const rows = (data ?? []) as Array<{
      provider: "google" | "zoom";
      account_email: string | null;
      scopes: string[] | null;
      updated_at: string | null;
      token_expires_at: string | null;
      is_active: boolean;
      refresh_token: string | null;
    }>;

    return (["google", "zoom"] as const).map((p) => {
      const providerRows = rows.filter((r) => r.provider === p);
      const active = providerRows.find((r) => r.is_active);
      const mostRecent = providerRows[0];
      const needsReconnect =
        !active && !!mostRecent && !mostRecent.is_active && !mostRecent.refresh_token;
      const r = active ?? null;
      return {
        provider: p,
        connected: !!active,
        needs_reconnect: needsReconnect,
        account_email: r?.account_email ?? null,
        scopes: r?.scopes ?? null,
        updated_at: r?.updated_at ?? null,
        token_expires_at: r?.token_expires_at ?? null,
      };
    });
  });

export const refreshIntegrationToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { provider: "google" | "zoom" }) =>
    providerSchema.parse(input),
  )
  .handler(async ({ data, context }) => {
    const { getProviderClient } = await import("./provider-client.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Force a refresh by clearing token_expires_at first
    await supabaseAdmin
      .from("calendar_connections")
      .update({ token_expires_at: new Date(0).toISOString() })
      .eq("user_id", context.userId)
      .eq("provider", data.provider)
      .eq("is_active", true);
    // Now getProviderClient will refresh
    const client = await getProviderClient(data.provider, context.userId);
    return { ok: true, account_email: client.accountEmail };
  });
