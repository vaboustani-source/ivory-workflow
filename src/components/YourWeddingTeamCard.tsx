import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { roleLabel, type ContractorRole } from "@/lib/contractors";

interface TeamMember {
  id: string;
  role: ContractorRole;
  contractor: { full_name: string; bio: string | null; portfolio_url: string | null; instagram: string | null } | null;
}

export function YourWeddingTeamCard({ clientId }: { clientId: string }) {
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("wedding_team")
        .select("id, role, contractor:contractors(full_name, bio, portfolio_url, instagram)")
        .eq("client_id", clientId);
      setTeam((data ?? []) as any);
      setLoaded(true);
    })();
  }, [clientId]);

  if (!loaded || team.length === 0) return null;

  return (
    <div className="bg-surface rounded-lg shadow-soft p-6 border-t-2 border-gold">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-4">Your wedding team</p>
      <ul className="space-y-3">
        {team.map((m) => (
          <li key={m.id} className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-full bg-plum/15 text-plum flex items-center justify-center font-serif italic shrink-0">
              {(m.contractor?.full_name ?? "?").charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-serif italic text-base text-primary">{m.contractor?.full_name ?? "—"}</p>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{roleLabel(m.role)}</p>
              {m.contractor?.bio && <p className="text-sm text-foreground/80 mt-1">{m.contractor.bio}</p>}
              <div className="flex gap-3 mt-1">
                {m.contractor?.portfolio_url && (
                  <a href={m.contractor.portfolio_url} target="_blank" rel="noopener noreferrer" className="text-xs text-magenta hover:underline">Portfolio</a>
                )}
                {m.contractor?.instagram && (
                  <a href={m.contractor.instagram.startsWith("http") ? m.contractor.instagram : `https://instagram.com/${m.contractor.instagram.replace("@", "")}`} target="_blank" rel="noopener noreferrer" className="text-xs text-magenta hover:underline">Instagram</a>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
