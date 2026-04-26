import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type AppRole } from "@/lib/auth";

const STORAGE_KEY = "sbv:view_as_user_id";

interface ViewAsUser {
  id: string;
  full_name: string | null;
  role: AppRole;
}

interface ViewAsContextValue {
  /** The user whose perspective the UI is currently using (impersonated or real). */
  effectiveUserId: string | null;
  effectiveRole: AppRole | null;
  effectiveName: string | null;
  /** The impersonation target, if any. */
  viewingAs: ViewAsUser | null;
  setViewAs: (target: ViewAsUser | null) => void;
  /** True if the *real* logged-in user is an owner. */
  isRealOwner: boolean;
}

const Ctx = createContext<ViewAsContextValue | undefined>(undefined);

export function ViewAsProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [viewingAs, setViewingAsState] = useState<ViewAsUser | null>(null);

  // Restore from sessionStorage on mount, but only if real user is owner.
  useEffect(() => {
    if (!profile) return;
    if (profile.role !== "owner") {
      setViewingAsState(null);
      sessionStorage.removeItem(STORAGE_KEY);
      return;
    }
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { id: string };
      // Refetch fresh profile data
      supabase
        .from("profiles")
        .select("id, full_name, role")
        .eq("id", parsed.id)
        .maybeSingle()
        .then(({ data }) => {
          if (data && data.role !== "owner") {
            setViewingAsState({ id: data.id, full_name: data.full_name, role: data.role as AppRole });
          }
        });
    } catch {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }, [profile?.id, profile?.role]);

  const setViewAs = (target: ViewAsUser | null) => {
    if (target && target.role === "owner") return; // never impersonate other owners
    if (target) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ id: target.id }));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
    setViewingAsState(target);
  };

  const isRealOwner = profile?.role === "owner";
  const effective = viewingAs && isRealOwner
    ? { id: viewingAs.id, role: viewingAs.role, name: viewingAs.full_name }
    : profile
      ? { id: profile.id, role: profile.role, name: profile.full_name }
      : { id: null, role: null, name: null };

  const value: ViewAsContextValue = {
    effectiveUserId: effective.id,
    effectiveRole: effective.role as AppRole | null,
    effectiveName: effective.name,
    viewingAs,
    setViewAs,
    isRealOwner: !!isRealOwner,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useViewAs() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useViewAs must be used within ViewAsProvider");
  return ctx;
}

/**
 * Returns a function that constrains a Supabase `.in()` filter on client_id
 * based on the effective user's scope. Returns null if no scoping needed (owner not viewing-as).
 *
 * Usage:
 *   const { scopeClientIds } = useEffectiveScope();
 *   const ids = await scopeClientIds(); // null = no scope; array = filter to these ids
 */
export function useEffectiveScope() {
  const { effectiveUserId, effectiveRole, isRealOwner, viewingAs } = useViewAs();

  // Owner not viewing-as: no scope (sees everything)
  const needsScope = !(isRealOwner && !viewingAs);

  const scopeClientIds = async (): Promise<string[] | null> => {
    if (!needsScope || !effectiveUserId) return null;
    if (effectiveRole === "owner") return null;
    // Manager + associate: scope to clients where they're manager or photographer
    const { data } = await supabase
      .from("clients")
      .select("id")
      .or(`manager_id.eq.${effectiveUserId},photographer_id.eq.${effectiveUserId}`);
    return (data ?? []).map((r) => r.id);
  };

  return { effectiveUserId, effectiveRole, needsScope, scopeClientIds };
}
