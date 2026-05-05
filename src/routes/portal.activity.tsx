import { createFileRoute } from "@tanstack/react-router";
import { PortalGate } from "@/components/PortalLayout";
import { ActivityList } from "@/components/ActivityList";

export const Route = createFileRoute("/portal/activity")({
  component: () => (
    <PortalGate>
      {({ clientId }) => (
        <div className="space-y-6">
          <div>
            <h1 className="font-serif italic text-[28px] md:text-[36px] text-primary leading-tight">Activity</h1>
            <p className="text-sm text-muted-foreground mt-1">What's been happening with your wedding.</p>
          </div>
          <div className="bg-surface rounded-lg shadow-soft p-6 border-t-2 border-gold">
            <ActivityList clientId={clientId} mode="couple" />
          </div>
        </div>
      )}
    </PortalGate>
  ),
});
