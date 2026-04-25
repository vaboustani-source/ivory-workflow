import { Link, useLocation } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import {
  Home, Users, Inbox, KanbanSquare, MessageCircle, Calendar,
  CheckSquare, Image, Receipt, BookOpen, Settings, Bell, Search,
  LogOut, Menu, X,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { firstName } from "@/lib/dates";

const NAV_ITEMS = [
  { label: "Dashboard", to: "/studio", icon: Home, exact: true },
  { label: "Clients", to: "/studio/clients", icon: Users },
  { label: "Approval Queue", to: "/studio/approval-queue", icon: Inbox },
  { label: "Pipeline", to: "/studio/pipeline", icon: KanbanSquare },
  { label: "Messages", to: "/studio/messages", icon: MessageCircle },
  { label: "Calendar", to: "/studio/calendar", icon: Calendar },
  { label: "Tasks", to: "/studio/tasks", icon: CheckSquare },
  { label: "Galleries", to: "/studio/galleries", icon: Image },
  { label: "Invoices", to: "/studio/invoices", icon: Receipt },
  { label: "Resources", to: "/studio/resources", icon: BookOpen },
  { label: "Settings", to: "/studio/settings/team", icon: Settings, matchPrefix: "/studio/settings" },
] as const;

export function StudioLayout({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const isActive = (item: typeof NAV_ITEMS[number]) => {
    if (item.exact) return location.pathname === item.to;
    if ("matchPrefix" in item && item.matchPrefix) return location.pathname.startsWith(item.matchPrefix);
    return location.pathname === item.to || location.pathname.startsWith(item.to + "/");
  };

  return (
    <div className="min-h-screen flex bg-background">
      {/* Sidebar */}
      <aside
        className={`${collapsed ? "w-[60px]" : "w-[220px]"} shrink-0 bg-sidebar text-sidebar-foreground flex flex-col transition-[width] duration-200 sticky top-0 h-screen`}
      >
        <div className="flex items-center justify-between px-4 py-6">
          {!collapsed && (
            <span className="font-serif italic text-2xl text-gold tracking-wide">SBV</span>
          )}
          {collapsed && (
            <span className="font-serif italic text-xl text-gold mx-auto">S</span>
          )}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="text-sidebar-foreground/70 hover:text-gold lg:hidden"
            aria-label="Toggle sidebar"
          >
            {collapsed ? <Menu size={18} /> : <X size={18} />}
          </button>
        </div>
        <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isActive(item);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`group flex items-center gap-3 px-3 py-2.5 rounded-sm text-sm transition-colors relative ${
                  active
                    ? "bg-sidebar-accent text-sidebar-foreground"
                    : "text-sidebar-foreground/80 hover:text-magenta"
                }`}
                title={collapsed ? item.label : undefined}
              >
                {active && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] bg-sidebar-foreground rounded-r" />
                )}
                <Icon size={18} className={active ? "text-gold" : ""} />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="p-2 border-t border-sidebar-border">
          <button
            onClick={() => signOut()}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-sm text-sm text-sidebar-foreground/70 hover:text-magenta"
            title="Sign out"
          >
            <LogOut size={18} />
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-10 h-16 bg-background border-b border-primary/20 flex items-center px-6 gap-6">
          <span className="font-serif text-primary text-lg tracking-[0.18em]">
            STORIES <span className="italic">by</span> VICTORIA
          </span>
          <div className="flex-1 flex justify-center">
            <div className="relative w-full max-w-[480px]">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                placeholder="Search clients, messages, notes…"
                className="w-full pl-9 pr-3 py-2 bg-surface border border-primary/15 rounded-sm text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>
          <button className="text-primary/70 hover:text-primary" aria-label="Notifications">
            <Bell size={18} />
          </button>
          <div className="h-8 w-8 rounded-full bg-plum text-background flex items-center justify-center text-xs font-medium">
            {firstName(profile?.full_name).charAt(0).toUpperCase()}
          </div>
        </header>

        <main className="flex-1 px-8 py-8">
          <div className="max-w-[1400px] mx-auto">{children}</div>
        </main>
      </div>
    </div>
  );
}
