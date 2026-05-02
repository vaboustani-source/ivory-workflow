import { createFileRoute, Outlet, Link, useLocation } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/studio/settings")({
  component: SettingsLayout,
});

function SettingsLayout() {
  const { profile } = useAuth();
  const isOwner = profile?.role === "owner";
  const location = useLocation();

  const items = [
    { label: "Profile", to: "/studio/settings/profile", visible: true },
    { label: "Team", to: "/studio/settings/team", visible: true },
    { label: "Workflow", to: "/studio/settings/workflow", visible: isOwner },
    { label: "Email Templates", to: "/studio/settings/email-templates", visible: true },
    { label: "Email copy", to: "/studio/settings/emails", visible: isOwner },
    { label: "Resources", to: "/studio/settings/resources", visible: true },
    { label: "Calendar", to: "/studio/settings/calendar", visible: true },
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
