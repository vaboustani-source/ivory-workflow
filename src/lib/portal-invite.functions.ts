// TanStack server function that sends a portal invitation via Postmark.
// Replaces the legacy `send-portal-invite` Resend edge function for all
// in-app callers. The edge function remains in place but unused (deprecated).
//
// Reuses the existing tokened welcome flow: the CTA in the email is
// /portal/welcome?token=…, which is the ONLY path that links auth.users to
// a clients row via the portal_invitations -> client_users handshake.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json, TablesInsert } from "@/integrations/supabase/types";

const inputSchema = z.object({
  client_id: z.string().uuid(),
  invitation_type: z.enum(["initial", "resend", "partner"]).default("initial"),
  invited_email: z.string().email().optional(),
  invited_role_in_couple: z.enum(["partner_1", "partner_2"]).default("partner_2"),
});

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function getPortalBaseUrl(): string {
  const envBase = process.env.PUBLIC_APP_URL || process.env.VITE_PUBLIC_APP_URL;
  if (envBase) return envBase.replace(/\/$/, "");
  return "https://studio.victoriaboustani.com";
}

export const sendPortalInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Authorize caller (owner or studio_manager for initial/resend;
    // partner-invite is sent by the couple themselves from the portal).
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, role, full_name")
      .eq("id", userId)
      .maybeSingle();
    if (!profile) {
      return { ok: false, error: "Profile not found." } as const;
    }
    const isPartnerInvite = data.invitation_type === "partner";
    const studioRoles = ["owner", "studio_manager"];
    if (!isPartnerInvite && !studioRoles.includes(profile.role)) {
      return { ok: false, error: "Not authorized to send portal invitations." } as const;
    }

    // Load client (RLS will scope to what the caller may see).
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("id, couple_name_1, couple_name_2, primary_email, manager_id, photographer_id")
      .eq("id", data.client_id)
      .maybeSingle();
    if (clientErr || !client) {
      return { ok: false, error: "Client not found or not accessible." } as const;
    }

    const recipient = (data.invited_email ?? client.primary_email ?? "").trim();
    if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      return { ok: false, error: "No valid recipient email on file." } as const;
    }

    // All privileged writes go through the admin client.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Create invitation token row.
    const token = randomToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { error: invErr } = await supabaseAdmin.from("portal_invitations").insert({
      client_id: data.client_id,
      invited_email: recipient,
      invited_by: userId,
      invitation_token: token,
      expires_at: expiresAt,
      invitation_type: data.invitation_type,
      invited_role_in_couple: data.invited_role_in_couple,
    });
    if (invErr) {
      return { ok: false, error: `Could not create invitation: ${invErr.message}` } as const;
    }

    // Build email body from editable copy.
    const { data: copyRow } = await supabaseAdmin
      .from("email_template_copy")
      .select("copy")
      .eq("email_type", "portal_invite")
      .maybeSingle();
    const overrides = ((copyRow?.copy as Record<string, string> | null) ?? {});

    const baseUrl = getPortalBaseUrl();
    const link = `${baseUrl}/portal/welcome?token=${token}`;
    const coupleFullNames =
      client.couple_name_1 + (client.couple_name_2 ? ` & ${client.couple_name_2}` : "");

    const { buildPortalInviteEmail } = await import("@/lib/portal-invite-render.server");
    const { subject, html, textBody } = buildPortalInviteEmail({
      overrides,
      link,
      coupleFirstNames: client.couple_name_1,
      coupleFullNames,
      variant: data.invitation_type,
    });

    const { sendEmail, POSTMARK_DEFAULTS } = await import("@/integrations/postmark/client.server");
    const sendResult = await sendEmail({
      to: recipient,
      subject,
      htmlBody: html,
      textBody,
      tag: "portal_invite",
      metadata: {
        client_id: data.client_id,
        invitation_type: data.invitation_type,
      },
    });

    const status = sendResult.success
      ? "sent"
      : sendResult.errorCode === "405" ||
          /test mode|approved sender/i.test(sendResult.error ?? "")
        ? "test_mode_blocked"
        : "failed";

    const logPayload: TablesInsert<"email_sends"> = {
      to_address: recipient,
      from_address: POSTMARK_DEFAULTS.from,
      reply_to: POSTMARK_DEFAULTS.replyTo,
      subject,
      template_key: "portal_invite",
      client_id: data.client_id,
      postmark_message_id: sendResult.messageId ?? null,
      status,
      error_message: sendResult.error ?? null,
      error_code: sendResult.errorCode ?? null,
      tag: "portal_invite",
      metadata: {
        invitation_type: data.invitation_type,
        invited_by: userId,
      } as Json,
      raw_response: (sendResult.rawResponse ?? null) as Json | null,
    };
    const { data: logRow } = await supabaseAdmin
      .from("email_sends")
      .insert(logPayload)
      .select("id")
      .single();

    // Stamp clients.portal_invited_at on initial/resend (not partner).
    if (data.invitation_type === "initial" || data.invitation_type === "resend") {
      await supabaseAdmin
        .from("clients")
        .update({ portal_invited_at: new Date().toISOString() })
        .eq("id", data.client_id);
    }

    // Activity log entry (never blocks).
    await supabaseAdmin.from("activity_log").insert({
      user_id: userId,
      action_type:
        data.invitation_type === "partner"
          ? "portal.partner_invite_sent"
          : status === "sent" || status === "test_mode_blocked"
            ? "portal.invite_sent"
            : "portal.invite_failed",
      target_type: "client",
      target_id: data.client_id,
      client_id: data.client_id,
      description:
        status === "sent" || status === "test_mode_blocked"
          ? `Portal invite (${data.invitation_type}) sent to ${recipient}`
          : `Portal invite (${data.invitation_type}) failed for ${recipient}: ${sendResult.error ?? "unknown"}`,
      metadata: {
        recipient,
        invitation_type: data.invitation_type,
        email_send_id: logRow?.id ?? null,
        test_mode: status === "test_mode_blocked",
      } as Json,
    });

    if (status === "failed") {
      // Notify every owner — never throw, never block the page.
      const { data: owners } = await supabaseAdmin
        .from("user_roles")
        .select("user_id")
        .eq("role", "owner");
      if (owners?.length) {
        const rows: TablesInsert<"notifications">[] = owners.map((o) => ({
          user_id: o.user_id,
          kind: "email_failed",
          title: "Portal invitation email failed to send",
          body: `${coupleFullNames}: ${sendResult.error ?? "unknown error"}`,
          link_to: `/studio/clients/${data.client_id}`,
        }));
        await supabaseAdmin.from("notifications").insert(rows);
      }
      return {
        ok: false,
        status,
        emailed: false,
        error: sendResult.error ?? "Postmark send failed",
        emailSendId: logRow?.id ?? null,
      } as const;
    }

    return {
      ok: true,
      status,
      emailed: status === "sent",
      messageId: sendResult.messageId ?? null,
      emailSendId: logRow?.id ?? null,
      link,
    } as const;
  });
