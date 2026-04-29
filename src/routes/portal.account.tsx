import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { PortalGate } from "@/components/PortalLayout";

export const Route = createFileRoute("/portal/account")({
  component: AccountLayoutRoute,
});

function AccountLayoutRoute() {
  return (
    <PortalGate>
      {() => <AccountLayout />}
    </PortalGate>
  );
}

const SUB_NAV = [
  { label: "Profile", to: "/portal/account" as const, exact: true },
  { label: "Login & security", to: "/portal/account/security" as const },
  { label: "Notifications", to: "/portal/account/notifications" as const },
  { label: "Partner", to: "/portal/account/partner" as const },
];

function AccountLayout() {
  const location = useLocation();
  return (
    <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-8">
      <nav className="space-y-1">
        {SUB_NAV.map((item) => {
          const active = item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`block px-3 py-2 rounded-sm text-sm transition-colors ${
                active ? "bg-background-alt text-primary border-l-2 border-gold" : "text-primary/70 hover:text-magenta"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div>
        <Outlet />
      </div>
    </div>
  );
}
