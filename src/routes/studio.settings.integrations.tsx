import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  listIntegrations,
  startOAuth,
  disconnectProvider,
  refreshIntegrationToken,
  type IntegrationStatus,
} from "@/lib/scheduling/integrations.functions";

type Search = { oauth?: "google" | "zoom"; status?: "ok" | "error"; detail?: string };

export const Route = createFileRoute("/studio/settings/integrations")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    oauth: s.oauth === "google" || s.oauth === "zoom" ? s.oauth : undefined,
    status: s.status === "ok" || s.status === "error" ? s.status : undefined,
    detail: typeof s.detail === "string" ? s.detail : undefined,
  }),
  component: IntegrationsPage,
});

const PROVIDERS: Array<{
  id: "google" | "zoom";
  name: string;
  description: string;
  scopeBlurb: string;
}> = [
  {
    id: "google",
    name: "Google Calendar",
    description:
      "Read busy times to avoid double-booking, and write new meetings (with Zoom link) to your calendar.",
    scopeBlurb: "calendar.events · calendar.readonly · email",
  },
  {
    id: "zoom",
    name: "Zoom",
    description:
      "Automatically create a Zoom meeting for every scheduled call and include the join link in the calendar event and confirmation email.",
    scopeBlurb: "meeting:write · meeting:read · user:read",
  },
];

function IntegrationsPage() {
  const search = useSearch({ from: Route.id });
  const qc = useQueryClient();
  const fetchList = useServerFn(listIntegrations);
  const startFn = useServerFn(startOAuth);
  const disconnectFn = useServerFn(disconnectProvider);
  const refreshFn = useServerFn(refreshIntegrationToken);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["integrations"],
    queryFn: async (): Promise<IntegrationStatus[]> => {
      const r = (await fetchList()) as unknown;
      // Defensive unwrap: some serverFn/middleware paths may return a wrapped
      // envelope ({ result: [...] } / { data: [...] }) or a non-array (Response,
      // error object). Normalize to IntegrationStatus[] so the UI never crashes.
      if (Array.isArray(r)) return r as IntegrationStatus[];
      if (r && typeof r === "object") {
        const maybe =
          (r as { result?: unknown }).result ??
          (r as { data?: unknown }).data;
        if (Array.isArray(maybe)) return maybe as IntegrationStatus[];
      }
      throw new Error("Unexpected response shape from listIntegrations");
    },
  });

  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!search.oauth || !search.status) return;
    const label = search.oauth === "google" ? "Google Calendar" : "Zoom";
    if (search.status === "ok") {
      toast.success(`${label} connected`);
    } else {
      toast.error(`${label} connection failed`, {
        description: search.detail ?? undefined,
      });
    }
    qc.invalidateQueries({ queryKey: ["integrations"] });
    // Clean the URL
    window.history.replaceState({}, "", "/studio/settings/integrations");
  }, [search.oauth, search.status, search.detail, qc]);

  const connect = useMutation({
    mutationFn: async (provider: "google" | "zoom") => {
      setBusy(`connect:${provider}`);
      const { url } = await startFn({ data: { provider } });
      window.location.href = url;
    },
    onError: (e: Error) => {
      setBusy(null);
      toast.error("Could not start connection", { description: e.message });
    },
  });

  const disconnect = useMutation({
    mutationFn: async (provider: "google" | "zoom") => {
      setBusy(`disconnect:${provider}`);
      await disconnectFn({ data: { provider } });
    },
    onSuccess: (_d, provider) => {
      setBusy(null);
      toast.success(`${provider === "google" ? "Google Calendar" : "Zoom"} disconnected`);
      qc.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (e: Error) => {
      setBusy(null);
      toast.error("Disconnect failed", { description: e.message });
    },
  });

  const refresh = useMutation({
    mutationFn: async (provider: "google" | "zoom") => {
      setBusy(`refresh:${provider}`);
      await refreshFn({ data: { provider } });
    },
    onSuccess: () => {
      setBusy(null);
      toast.success("Token refreshed");
      qc.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (e: Error) => {
      setBusy(null);
      toast.error("Refresh failed", { description: e.message });
    },
  });

  const rows: IntegrationStatus[] = Array.isArray(data) ? data : [];
  const byProvider = new Map<string, IntegrationStatus>(
    rows.map((r) => [r.provider, r]),
  );

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-medium">Integrations</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Connect Google Calendar and Zoom so the scheduling system can read your availability,
          create meetings, and add events to your calendar.
        </p>
      </header>

      {isError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm flex items-center justify-between gap-3">
          <span>
            Couldn't load your integrations
            {error instanceof Error && error.message ? `: ${error.message}` : "."}
          </span>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {rows.some((r) => r.needs_reconnect) && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          One or more connections were revoked at the provider. Click <strong>Connect</strong> below
          to reauthorize so scheduling keeps working.
        </div>
      )}


      <div className="space-y-4">
        {PROVIDERS.map((p) => {
          const row = byProvider.get(p.id);
          const connected = !!row?.connected;
          return (
            <Card key={p.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      {p.name}
                      {connected ? (
                        <Badge variant="default" className="font-normal">Connected</Badge>
                      ) : (
                        <Badge variant="outline" className="font-normal">Not connected</Badge>
                      )}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">{p.description}</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {isLoading ? (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                ) : connected && row ? (
                  <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-sm">
                    <dt className="text-muted-foreground">Account</dt>
                    <dd>{row.account_email ?? "—"}</dd>
                    <dt className="text-muted-foreground">Connected</dt>
                    <dd>{row.updated_at ? new Date(row.updated_at).toLocaleString() : "—"}</dd>
                    <dt className="text-muted-foreground">Token expires</dt>
                    <dd>
                      {row.token_expires_at
                        ? new Date(row.token_expires_at).toLocaleString()
                        : "—"}
                    </dd>
                    <dt className="text-muted-foreground">Scopes</dt>
                    <dd className="text-xs text-muted-foreground break-all">
                      {row.scopes?.join(" ") ?? p.scopeBlurb}
                    </dd>
                  </dl>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Scopes requested: <span className="text-xs">{p.scopeBlurb}</span>
                  </p>
                )}

                <div className="flex gap-2 pt-1">
                  {connected ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => refresh.mutate(p.id)}
                      >
                        {busy === `refresh:${p.id}` ? "Refreshing…" : "Refresh token"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => disconnect.mutate(p.id)}
                      >
                        {busy === `disconnect:${p.id}` ? "Disconnecting…" : "Disconnect"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => connect.mutate(p.id)}
                      >
                        Reconnect
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => connect.mutate(p.id)}
                    >
                      {busy === `connect:${p.id}` ? "Redirecting…" : `Connect ${p.name}`}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
