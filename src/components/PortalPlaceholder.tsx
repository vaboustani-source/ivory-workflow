export function PortalPlaceholder() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="bg-surface rounded-lg shadow-soft p-12 text-center border-t-2 border-gold max-w-md">
        <p className="font-serif italic text-[28px] text-primary">Coming soon.</p>
        <p className="text-sm text-muted-foreground mt-3">
          This part of your portal is being prepared with care.
        </p>
      </div>
    </div>
  );
}
