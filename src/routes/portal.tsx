import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/portal")({
  component: PortalPlaceholder,
});

function PortalPlaceholder() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="text-center max-w-md">
        <h1 className="font-serif italic text-4xl text-primary">Welcome to your story.</h1>
        <p className="mt-4 text-sm text-muted-foreground">
          Your wedding portal is being prepared with care.
        </p>
      </div>
    </div>
  );
}
