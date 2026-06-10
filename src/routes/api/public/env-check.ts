// TEMPORARY: one-shot env-presence probe for Stage 6 verification.
// Returns booleans only — never the actual secret values.
// Gated by Authorization: Bearer <SERVICE_ROLE_KEY>. DELETE after use.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/env-check")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const expected = `Bearer ${process.env.SERVICE_ROLE_KEY ?? ""}`;
        if (!process.env.SERVICE_ROLE_KEY || auth !== expected) {
          return new Response("forbidden", { status: 403 });
        }
        const names = [
          "EMAIL_PAYMENT_CONFIRMATION_ENABLED",
          "POSTMARK_SERVER_TOKEN",
          "SB_URL",
          "SERVICE_ROLE_KEY",
          "STRIPE_SECRET_KEY",
          "STRIPE_WEBHOOK_SECRET",
        ] as const;
        const result = names.map((n) => {
          const v = process.env[n];
          const present = typeof v === "string" && v.length > 0;
          const out: Record<string, unknown> = { name: n, present };
          if (n === "EMAIL_PAYMENT_CONFIRMATION_ENABLED") {
            out.equals_string_true = v === "true";
          }
          return out;
        });
        return Response.json({ checks: result });
      },
    },
  },
});
