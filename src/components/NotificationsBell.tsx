import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { relativeTime } from "@/lib/dates";

interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link_to: string | null;
  read_at: string | null;
  created_at: string;
}

export function NotificationsBell({ userId }: { userId: string | null }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  const load = async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("notifications")
      .select("id,kind,title,body,link_to,read_at,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);
    setItems((data ?? []) as Notification[]);
  };

  useEffect(() => {
    load();
    if (!userId) return;
    const channel = supabase
      .channel(`notifs:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => load(),
      )
      .subscribe();
    const interval = setInterval(load, 60000);
    return () => { supabase.removeChannel(channel); clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const unread = items.filter((n) => !n.read_at).length;

  const markAllRead = async () => {
    if (!userId) return;
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", userId)
      .is("read_at", null);
    load();
  };

  const handleClick = async (n: Notification) => {
    if (!n.read_at) {
      await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id);
    }
    setOpen(false);
    load();
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-primary/70 hover:text-primary relative"
        aria-label="Notifications"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 bg-magenta text-background text-[9px] font-semibold rounded-full px-1 min-w-[14px] h-[14px] inline-flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-30 bg-surface rounded-md shadow-elevated border border-border w-[360px] py-2 max-h-[480px] overflow-y-auto">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <p className="text-sm font-serif italic text-primary">Notifications</p>
              {unread > 0 && (
                <button onClick={markAllRead} className="text-[11px] text-muted-foreground hover:text-primary">
                  Mark all read
                </button>
              )}
            </div>
            {items.length === 0 ? (
              <p className="text-xs text-muted-foreground italic text-center py-6">No notifications.</p>
            ) : (
              items.map((n) => {
                const body = (
                  <div className={`px-3 py-2.5 border-b border-border last:border-b-0 hover:bg-background-alt/50 ${!n.read_at ? "bg-gold/5" : ""}`}>
                    <div className="flex items-start gap-2">
                      {!n.read_at && <span className="h-1.5 w-1.5 rounded-full bg-magenta mt-1.5 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground">{n.title}</p>
                        {n.body && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>}
                        <p className="text-[10px] text-muted-foreground mt-1">{relativeTime(n.created_at)}</p>
                      </div>
                    </div>
                  </div>
                );
                return n.link_to ? (
                  <Link key={n.id} to={n.link_to} onClick={() => handleClick(n)} className="block">
                    {body}
                  </Link>
                ) : (
                  <button key={n.id} onClick={() => handleClick(n)} className="block w-full text-left">
                    {body}
                  </button>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
