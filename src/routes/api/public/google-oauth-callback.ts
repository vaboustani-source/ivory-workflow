import { createFileRoute } from "@tanstack/react-router";
import { getCookie, deleteCookie } from "@tanstack/react-start/server";

export const Route = createFileRoute("/api/public/google-oauth-callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        return handleCallback("google", request);
      },
    },
  },
});

async function handleCallback(provider: "google" | "zoom", request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const cookieName = `lov_oauth_nonce_${provider}`;
  const nonce = getCookie(cookieName);
  deleteCookie(cookieName, { path: "/" });

  const back = (status: "ok" | "error", detail?: string) => {
    const redirect = new URL("/studio/settings/integrations", url.origin);
    redirect.searchParams.set("oauth", provider);
    redirect.searchParams.set("status", status);
    if (detail) redirect.searchParams.set("detail", detail.slice(0, 120));
    return new Response(null, { status: 302, headers: { Location: redirect.toString() } });
  };

  if (error) return back("error", error);
  if (!code || !state || !nonce) return back("error", "missing_params");

  const { verifyState, exchangeCode, fetchAccountEmail, callbackPath } =
    await import("@/lib/scheduling/oauth-config.server");
  const verified = verifyState(state, nonce);
  if (!verified) return back("error", "bad_state");

  try {
    const redirectUri = `${url.origin}${callbackPath(provider)}`;
    const tok = await exchangeCode(provider, code, redirectUri);
    const accountEmail = await fetchAccountEmail(provider, tok.access_token);
    const expiresAt = new Date(Date.now() + tok.expires_in * 1000).toISOString();
    const scopes = tok.scope ? tok.scope.split(/\s+/).filter(Boolean) : null;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Deactivate any existing active rows for this (user, provider) before inserting
    await supabaseAdmin
      .from("calendar_connections")
      .update({ is_active: false })
      .eq("user_id", verified.u)
      .eq("provider", provider)
      .eq("is_active", true);

    const insert: Record<string, unknown> = {
      user_id: verified.u,
      provider,
      access_token: tok.access_token,
      refresh_token: tok.refresh_token ?? null,
      token_expires_at: expiresAt,
      scopes,
      account_email: accountEmail,
      is_active: true,
    };
    if (provider === "google") {
      insert.calendar_id = "primary";
    }
    const { error: insertErr } = await supabaseAdmin
      .from("calendar_connections")
      .insert(insert);
    if (insertErr) return back("error", insertErr.message);

    return back("ok");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return back("error", msg);
  }
}

export { handleCallback };
