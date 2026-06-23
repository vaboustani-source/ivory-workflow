import { createFileRoute, Outlet, Link, useLocation } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/studio/settings")({
  component: SettingsLayout,
});

function SettingsLayout() {
  const { profile, roles } = useAuth();
  const isOwner = profile?.role === "owner";
  const canSeeTax = isOwner || roles.includes("studio_manager") || roles.includes("owner");
  const location = useLocation();

  const items = [
    { label: "Profile", to: "/studio/settings/profile", visible: true },
    { label: "Studio Profile", to: "/studio/settings/studio-profile", visible: isOwner },
    { label: "Team", to: "/studio/settings/team", visible: true },
    { label: "Contractors", to: "/studio/settings/contractors", visible: true },
    { label: "1099 / Taxes", to: "/studio/settings/contractors-tax", visible: canSeeTax },
    // Packages tab hidden from nav — table still powers invoicing until quote-builder migration. Do not delete.
    { label: "Services", to: "/studio/settings/services", visible: true },
    { label: "Contract templates", to: "/studio/settings/contract-templates", visible: true },
    { label: "Contract Defaults", to: "/studio/settings/contract-defaults", visible: isOwner },
    { label: "Workflow", to: "/studio/settings/workflow", visible: isOwner },
    { label: "Email Templates", to: "/studio/settings/email-templates", visible: true },
    { label: "Email copy", to: "/studio/settings/emails", visible: isOwner },
    { label: "Resources", to: "/studio/settings/resources", visible: true },
    { label: "Calendar", to: "/studio/settings/calendar", visible: true },
    { label: "Scheduling", to: "/studio/settings/scheduling", visible: isOwner },
    { label: "Integrations", to: "/studio/settings/integrations", visible: true },
    { label: "Activity Log", to: "/studio/settings/activity-log", visible: isOwner },
    { label: "Storage", to: "/studio/settings/storage", visible: isOwner },
  ].filter((i) => i.visible);

  return (
    <div className="flex gap-8">
      <aside className="w-[200px] shrink-0">
        <nav className="space-y-1">
          {items.map((it) => {
            const active = location.pathname === it.to;
            return (
              <Link
                key={it.to}
                to={it.to}
                className={`block px-3 py-2 rounded-sm text-sm transition-colors ${
                  active ? "bg-background-alt text-primary font-medium" : "text-muted-foreground hover:text-primary"
                }`}
              >
                {it.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
