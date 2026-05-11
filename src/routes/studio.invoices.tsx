import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { TemplatesTab } from "@/components/invoicing/TemplatesTab";

export const Route = createFileRoute("/studio/invoices")({
  component: InvoicingPage,
});

type Tab = "all" | "upcoming" | "overdue" | "reschedule" | "templates";

const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All Invoices" },
  { key: "upcoming", label: "Upcoming" },
  { key: "overdue", label: "Overdue" },
  { key: "reschedule", label: "Reschedule Requests" },
  { key: "templates", label: "Templates" },
];

function InvoicingPage() {
  const [tab, setTab] = useState<Tab>("templates");

  return (
    <div className="-mx-8 -my-8 min-h-[calc(100vh-4rem)]" style={{ background: "var(--sbv-ivory)" }}>
      <div className="px-10 pt-10 pb-6">
        <h1 className="font-serif text-4xl mb-1" style={{ color: "var(--sbv-green)" }}>Invoicing</h1>
        <p className="text-sm" style={{ color: "var(--sbv-purple)" }}>
          Manage payment schedules, invoices, and reschedule requests.
        </p>
      </div>

      <div className="px-10 border-b" style={{ borderColor: "rgba(65,25,40,0.15)" }}>
        <nav className="flex gap-7">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className="relative pb-3 pt-1 text-sm transition-colors"
                style={{
                  color: active ? "var(--sbv-green)" : "var(--sbv-purple)",
                  fontWeight: active ? 600 : 400,
                }}
              >
                {t.label}
                {active && (
                  <span
                    className="absolute left-0 right-0 -bottom-px h-[2px]"
                    style={{ background: "var(--sbv-fuchsia)" }}
                  />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="px-10 py-8">
        {tab === "templates" && <TemplatesTab />}
        {tab !== "templates" && (
          <div className="py-24 text-center">
            <p className="font-serif italic text-2xl" style={{ color: "var(--sbv-purple)" }}>
              Coming soon.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
