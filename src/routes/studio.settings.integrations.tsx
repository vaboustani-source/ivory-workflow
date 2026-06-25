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
  type IntegrationsList,
  type ConnectionRow,
} from "@/lib/scheduling/integrations.functions";
import {
  getGmailAccount, startGmailOAuth, disconnectGmail,
  type GmailAccountInfo,
} from "@/lib/gmail/oauth.functions";

type Search = { oauth?: "google" | "zoom" | "gmail"; status?: "ok" | "error"; detail?: string };

export const Route = createFileRoute("/studio/settings/integrations")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    oauth: s.oauth === "google" || s.oauth === "zoom" || s.oauth === "gmail" ? s.oauth : undefined,
    status: s.status === "ok" || s.status === "error" ? s.status : undefined,
    detail: typeof s.detail === "string" ? s.detail : undefined,
  }),
  component: IntegrationsPage,
});

const GOOGLE_SCOPE_BLURB = "calendar.events · calendar.readonly · email";
const ZOOM_SCOPE_BLURB = "meeting:write · meeting:read · user:read";
const GMAIL_SCOPE_BLURB = "gmail.modify · gmail.send · email";

function IntegrationsPage() {
  const search = useSearch({ from: Route.id });
  const qc = useQueryClient();
  const fetchList = useServerFn(listIntegrations);
  const startFn = useServerFn(startOAuth);
  const disconnectFn = useServerFn(disconnectProvider);
  const refreshFn = useServerFn(refreshIntegrationToken);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["integrations"],
    queryFn: async (): Promise<IntegrationsList> => {
      const r = (await fetchList()) as unknown;
      if (r && typeof r === "object" && "google" in r) return r as IntegrationsList;
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
    mutationFn: async (args: { provider: "google" | "zoom"; connection_id?: string; label?: string }) => {
      setBusy(`disconnect:${args.connection_id ?? args.provider}`);
      await disconnectFn({ data: { provider: args.provider, connection_id: args.connection_id } });
      return args;
    },
    onSuccess: (args) => {
      setBusy(null);
      toast.success(`${args.label ?? (args.provider === "google" ? "Google Calendar" : "Zoom")} disconnected`);
      qc.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (e: Error) => {
      setBusy(null);
      toast.error("Disconnect failed", { description: e.message });
    },
  });

  const refresh = useMutation({
    mutationFn: async (args: { provider: "google" | "zoom"; connection_id?: string }) => {
      setBusy(`refresh:${args.connection_id ?? args.provider}`);
      await refreshFn({ data: { provider: args.provider, connection_id: args.connection_id } });
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

  const list: IntegrationsList = data ?? {
    google: [],
    google_needs_reconnect: false,
    zoom: null,
    zoom_needs_reconnect: false,
  };

  const renderRow = (r: ConnectionRow) => (
    <dl className="grid grid-cols-[140px_1fr] gap-y-1 text-sm">
      <dt className="text-muted-foreground">Account</dt>
      <dd className="flex items-center gap-2">
        {r.account_email ?? "—"}
        {r.is_booking_target && (
          <Badge variant="outline" className="font-normal text-[10px]">
            Booking target
          </Badge>
        )}
      </dd>
      <dt className="text-muted-foreground">Connected</dt>
      <dd>{r.updated_at ? new Date(r.updated_at).toLocaleString() : "—"}</dd>
      <dt className="text-muted-foreground">Token expires</dt>
      <dd>{r.token_expires_at ? new Date(r.token_expires_at).toLocaleString() : "—"}</dd>
      <dt className="text-muted-foreground">Busy calendars</dt>
      <dd className="text-xs">{r.busy_calendar_ids.join(", ")}</dd>
    </dl>
  );

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-medium">Integrations</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Connect Google Calendar and Zoom so scheduling can read your availability,
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

      {(list.google_needs_reconnect || list.zoom_needs_reconnect) && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          A connection was revoked at the provider. Click <strong>Connect</strong> below to reauthorize.
        </div>
      )}

      {/* GOOGLE — multi-account */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                Google Calendar
                {list.google.length > 0 ? (
                  <Badge variant="default" className="font-normal">
                    {list.google.length} connected
                  </Badge>
                ) : (
                  <Badge variant="outline" className="font-normal">Not connected</Badge>
                )}
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Connect multiple Google accounts (e.g. personal + professional). Busy
                time from EVERY connected account blocks call slots. New booked calls
                are written to the account marked as the booking target.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : list.google.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Scopes requested: <span className="text-xs">{GOOGLE_SCOPE_BLURB}</span>
            </p>
          ) : (
            <div className="space-y-4">
              {list.google.map((r) => (
                <div key={r.id} className="rounded-md border p-3 space-y-3">
                  {renderRow(r)}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => refresh.mutate({ provider: "google", connection_id: r.id })}
                    >
                      {busy === `refresh:${r.id}` ? "Refreshing…" : "Refresh token"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() =>
                        disconnect.mutate({
                          provider: "google",
                          connection_id: r.id,
                          label: r.account_email ?? "Google account",
                        })
                      }
                    >
                      {busy === `disconnect:${r.id}` ? "Disconnecting…" : "Disconnect"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div>
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={() => connect.mutate("google")}
            >
              {busy === "connect:google"
                ? "Redirecting…"
                : list.google.length === 0
                  ? "Connect Google Calendar"
                  : "Connect another Google account"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ZOOM — single account */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                Zoom
                {list.zoom ? (
                  <Badge variant="default" className="font-normal">Connected</Badge>
                ) : (
                  <Badge variant="outline" className="font-normal">Not connected</Badge>
                )}
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Automatically creates a Zoom meeting for every booked call.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : list.zoom ? (
            <>
              {renderRow(list.zoom)}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => refresh.mutate({ provider: "zoom" })}
                >
                  {busy === "refresh:zoom" ? "Refreshing…" : "Refresh token"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => disconnect.mutate({ provider: "zoom", label: "Zoom" })}
                >
                  {busy === "disconnect:zoom" ? "Disconnecting…" : "Disconnect"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => connect.mutate("zoom")}
                >
                  Reconnect
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Scopes requested: <span className="text-xs">{ZOOM_SCOPE_BLURB}</span>
              </p>
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={() => connect.mutate("zoom")}
              >
                {busy === "connect:zoom" ? "Redirecting…" : "Connect Zoom"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
