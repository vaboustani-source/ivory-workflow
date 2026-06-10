import { createFileRoute } from "@tanstack/react-router";
import { handleCallback } from "./google-oauth-callback";

export const Route = createFileRoute("/api/public/zoom-oauth-callback")({
  server: {
    handlers: {
      GET: async ({ request }) => handleCallback("zoom", request),
    },
  },
});
