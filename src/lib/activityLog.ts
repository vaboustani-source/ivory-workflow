import { supabase } from "@/integrations/supabase/client";

export type LogActivityArgs = {
  client_id: string;
  action_type: string;
  description: string;
  client_facing_text?: string | null;
  is_client_visible?: boolean;
  target_type?: string | null;
  target_id?: string | null;
  metadata?: Record<string, unknown>;
};

/** Fire-and-forget activity log insert. Never throws. */
export async function logActivity(args: LogActivityArgs): Promise<void> {
  try {
    const { data: userData } = await supabase.auth.getUser();
    await supabase.from("activity_log").insert({
      client_id: args.client_id,
      action_type: args.action_type,
      description: args.description,
      client_facing_text: args.client_facing_text ?? null,
      is_client_visible: args.is_client_visible ?? false,
      target_type: args.target_type ?? null,
      target_id: args.target_id ?? null,
      metadata: (args.metadata ?? {}) as never,
      user_id: userData?.user?.id ?? null,
    });
  } catch {
    /* swallow */
  }
}
