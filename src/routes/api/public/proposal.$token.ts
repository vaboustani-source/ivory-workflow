import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Public, token-addressed proposal endpoint (mirrors /api/public/couple-invoices).
// Leads open their proposal from an email link with no account or password;
// the portal login only enters the picture after they book.

// Server-side canonical add-on prices; client-sent prices are never trusted.
const ADDON_CATALOG: Record<string, number> = {
  "Heirloom wedding album": 1133,
  "Parent albums": 721,
  "Rehearsal dinner coverage": 1545,
  "35mm film add-on": 412,
  "Second videographer": 1030,
  "Additional event coverage": 824,
};

function badToken() {
  return Response.json({ error: "invalid_token" }, { status: 404 });
}

async function resolveProposal(token: string) {
  if (!token || token.length < 16 || token.length > 256 || !/^[a-zA-Z0-9_-]+$/.test(token)) return null;
  const { data: proposal } = await supabaseAdmin
    .from("proposals")
    .select("id, client_id, status, sent_at, accepted_at, line_items, subtotal, total, discount, personal_note, valid_until, options, selected_option, change_request, change_requested_at")
    .eq("view_token", token)
    .maybeSingle();
  if (!proposal || proposal.status === "draft") return null;
  return proposal;
}

async function notifyStudio(clientId: string, kind: string, title: string, body: string) {
  const [{ data: owners }, { data: client }] = await Promise.all([
    supabaseAdmin.from("user_roles").select("user_id").eq("role", "owner"),
    supabaseAdmin.from("clients").select("manager_id").eq("id", clientId).maybeSingle(),
  ]);
  const ids = new Set<string>((owners ?? []).map((o: any) => o.user_id));
  if (client?.manager_id) ids.add(client.manager_id);
  if (ids.size === 0) return;
  await supabaseAdmin.from("notifications").insert(
    [...ids].map((user_id) => ({
      user_id, kind, title, body,
      link_to: `/studio/clients/${clientId}?tab=documents`,
    })),
  );
}

export const Route = createFileRoute("/api/public/proposal/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const proposal = await resolveProposal(params.token);
        if (!proposal) return badToken();
        const { data: client } = await supabaseAdmin
          .from("clients")
          .select("couple_name_1, couple_name_2, wedding_date, venue_name")
          .eq("id", proposal.client_id)
          .maybeSingle();
        const { client_id: _omit, ...safe } = proposal as any;
        return Response.json({ proposal: safe, client: client ?? null });
      },

      POST: async ({ params, request }) => {
        const proposal = await resolveProposal(params.token);
        if (!proposal) return badToken();

        let body: any;
        try { body = await request.json(); } catch { return Response.json({ error: "bad_request" }, { status: 400 }); }
        const action = body?.action;
        const note = typeof body?.note === "string" ? body.note.trim().slice(0, 2000) : "";

        const { data: client } = await supabaseAdmin
          .from("clients")
          .select("couple_name_1, couple_name_2")
          .eq("id", proposal.client_id)
          .maybeSingle();
        const couple = client
          ? client.couple_name_1 + (client.couple_name_2 ? ` & ${client.couple_name_2}` : "")
          : "A couple";

        if (action === "accept") {
          if (proposal.status !== "sent") {
            return Response.json({ error: "not_open" }, { status: 409 });
          }
          if (proposal.valid_until && proposal.valid_until < new Date().toISOString().slice(0, 10)) {
            return Response.json({ error: "expired" }, { status: 409 });
          }
          const addonNames: string[] = Array.isArray(body?.addons)
            ? body.addons.filter((n: unknown): n is string => typeof n === "string" && n in ADDON_CATALOG)
            : [];
          const addonItems = addonNames.map((n) => ({ label: `Add-on: ${n}`, amount: ADDON_CATALOG[n] }));
          const addonSum = addonItems.reduce((t, it) => t + it.amount, 0);

          const options: any[] = Array.isArray(proposal.options) ? proposal.options : [];
          const patch: Record<string, unknown> = {
            status: "accepted",
            accepted_at: new Date().toISOString(),
            acceptance_note: note || null,
          };
          let chosenName: string | null = null;
          let grandTotal: number | null = null;
          if (options.length > 0) {
            const opt = options.find((o) => o?.key === body?.option_key);
            if (!opt) return Response.json({ error: "option_required" }, { status: 400 });
            patch.selected_option = opt.key;
            patch.line_items = [...(opt.line_items ?? []), ...addonItems];
            patch.subtotal = Number(opt.subtotal ?? opt.total ?? 0) + addonSum;
            patch.discount = opt.discount ?? 0;
            grandTotal = Number(opt.total ?? 0) + addonSum;
            patch.total = grandTotal;
            chosenName = opt.name ?? opt.key;
          } else if (addonItems.length > 0) {
            const base: any[] = Array.isArray(proposal.line_items) ? proposal.line_items : [];
            patch.line_items = [...base, ...addonItems];
            grandTotal = Number(proposal.total ?? 0) + addonSum;
            patch.subtotal = Number(proposal.subtotal ?? proposal.total ?? 0) + addonSum;
            patch.total = grandTotal;
          }
          const { error } = await supabaseAdmin.from("proposals").update(patch).eq("id", proposal.id);
          if (error) return Response.json({ error: "save_failed" }, { status: 500 });
          // Cascade the agreed numbers to the quote, client package price, and flags.
          await supabaseAdmin.rpc("sync_accepted_proposal", { p_proposal_id: proposal.id });
          await notifyStudio(
            proposal.client_id, "proposal_accepted", "Proposal accepted",
            couple + (chosenName ? ` accepted "${chosenName}"` : " accepted their proposal")
              + (addonNames.length ? ` with ${addonNames.length} add-on${addonNames.length > 1 ? "s" : ""} (${addonNames.join(", ")})` : "")
              + (grandTotal != null ? ` at $${grandTotal.toLocaleString()}` : "")
              + (note ? `. Note: "${note.slice(0, 140)}"` : ""),
          );
          return Response.json({ ok: true });
        }

        if (action === "change") {
          if (proposal.status !== "sent") {
            return Response.json({ error: "not_open" }, { status: 409 });
          }
          if (!note) return Response.json({ error: "note_required" }, { status: 400 });
          const { error } = await supabaseAdmin
            .from("proposals")
            .update({ change_request: note, change_requested_at: new Date().toISOString() })
            .eq("id", proposal.id);
          if (error) return Response.json({ error: "save_failed" }, { status: 500 });
          await notifyStudio(
            proposal.client_id, "proposal_change_request", "Proposal change requested",
            `${couple}: "${note.slice(0, 180)}${note.length > 180 ? "…" : ""}"`,
          );
          return Response.json({ ok: true });
        }

        return Response.json({ error: "unknown_action" }, { status: 400 });
      },
    },
  },
});
