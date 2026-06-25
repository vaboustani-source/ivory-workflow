// Gmail OAuth callback. Mirrors google-oauth-callback.ts but writes to
// gmail_accounts (per-user mailbox) and redirects back to Integrations.
import { createFileRoute } from "@tanstack/react-router";
import { getCookie, deleteCookie } from "@tanstack/react-start/server";

export const Route = createFileRoute("/api/public/gmail-oauth-callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const errParam = url.searchParams.get("error");
        const cookieName = "lov_oauth_nonce_gmail";
        const nonce = getCookie(cookieName);
        deleteCookie(cookieName, { path: "/" });

        const back = (status: "ok" | "error", detail?: string) => {
          const redirect = new URL("/studio/settings/integrations", url.origin);
          redirect.searchParams.set("oauth", "gmail");
          redirect.searchParams.set("status", status);
          if (detail) redirect.searchParams.set("detail", detail.slice(0, 120));
          return new Response(null, {
            status: 302,
            headers: { Location: redirect.toString() },
          });
        };

        if (errParam) return back("error", errParam);
        if (!code || !state || !nonce) return back("error", "missing_params");

        const { verifyState, exchangeCode, fetchAccountEmail, callbackPath } =
          await import("@/lib/scheduling/oauth-config.server");
        const verified = verifyState(state, nonce);
        if (!verified) return back("error", "bad_state");

        try {
          const redirectUri = `${url.origin}${callbackPath("gmail")}`;
          const tok = await exchangeCode("gmail", code, redirectUri);
          const accountEmail = await fetchAccountEmail("gmail", tok.access_token);
          const expiresAt = new Date(Date.now() + tok.expires_in * 1000).toISOString();
          const scopes = tok.scope ? tok.scope.split(/\s+/).filter(Boolean) : null;

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          // Replace any prior active row for this user (single Gmail per user
          // in slice 1). The unique index also guards per-(user,email).
          await supabaseAdmin
            .from("gmail_accounts")
            .update({ is_active: false })
            .eq("user_id", verified.u)
            .eq("is_active", true);

          const { error: insertErr } = await supabaseAdmin
            .from("gmail_accounts")
            .insert({
              user_id: verified.u,
              email: accountEmail,
              access_token: tok.access_token,
              refresh_token: tok.refresh_token ?? null,
              token_expires_at: expiresAt,
              scopes,
              is_active: true,
            });
          if (insertErr) return back("error", insertErr.message);

          await supabaseAdmin.from("activity_log").insert({
            user_id: verified.u,
            action_type: "integration.connect",
            target_type: "gmail_account",
            description: `Connected Gmail${accountEmail ? ` (${accountEmail})` : ""}`,
            metadata: { provider: "gmail", account_email: accountEmail },
          });

          return back("ok");
        } catch (e) {
          const msg = e instanceof Error ? e.message : "unknown";
          return back("error", msg);
        }
      },
    },
  },
});
