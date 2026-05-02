// Loads copy overrides for a given email_type from email_template_copy.
// Returns {} if no row / no overrides — callers fall back to schema defaults.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export async function loadCopyOverrides(
  admin: ReturnType<typeof createClient>,
  emailType: string,
): Promise<Record<string, string>> {
  try {
    const { data } = await admin
      .from("email_template_copy")
      .select("copy")
      .eq("email_type", emailType)
      .maybeSingle();
    return ((data?.copy as Record<string, string> | null) ?? {});
  } catch (e) {
    console.warn("loadCopyOverrides failed; falling back to defaults", e);
    return {};
  }
}
