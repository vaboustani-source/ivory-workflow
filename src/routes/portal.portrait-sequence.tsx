import { createFileRoute } from "@tanstack/react-router";
import { PortalGate } from "@/components/PortalLayout";
import { PortraitSequenceViewer } from "@/components/PortraitSequenceViewer";

export const Route = createFileRoute("/portal/portrait-sequence")({
  component: PortalPortraitSequenceRoute,
});

function PortalPortraitSequenceRoute() {
  return <PortalGate>{({ clientId }) => <PortalPortraitSequencePage clientId={clientId} />}</PortalGate>;
}

function PortalPortraitSequencePage({ clientId }: { clientId: string }) {
  return (
    <div className="space-y-8">
      <header className="text-center">
        <h1 className="font-serif italic text-[28px] md:text-[32px] text-primary">Family Portraits</h1>
        <p className="text-sm text-muted-foreground mt-2">
          We've planned out your family portraits. Take a look and let us know if anything looks off.
        </p>
      </header>
      <PortraitSequenceViewer clientId={clientId} editable={false} coupleApproval={true} coupleEditable={true} />
    </div>
  );
}
