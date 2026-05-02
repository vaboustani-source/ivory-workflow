import { createFileRoute } from "@tanstack/react-router";
import { PortalGate } from "@/components/PortalLayout";
import { TimelineDisplay } from "@/components/TimelineDisplay";

export const Route = createFileRoute("/portal/timeline")({
  component: PortalTimelineRoute,
});

function PortalTimelineRoute() {
  return <PortalGate>{({ clientId }) => <PortalTimelinePage clientId={clientId} />}</PortalGate>;
}

function PortalTimelinePage({ clientId }: { clientId: string }) {
  return (
    <div className="space-y-8">
      <header className="text-center">
        <h1 className="font-serif italic text-[28px] md:text-[32px] text-primary">Your wedding day timeline</h1>
        <p className="text-sm text-muted-foreground mt-2">Generated from your logistics form. Reach out if anything looks off.</p>
      </header>
      <TimelineDisplay clientId={clientId} editable={false} />
    </div>
  );
}
