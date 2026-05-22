// TEMPORARY — used once to verify RLS through the real PostgREST path. Delete after.
import { createFileRoute } from '@tanstack/react-router';
import { supabaseAdmin } from '@/integrations/supabase/client.server';

export const Route = createFileRoute('/api/public/__test_mint_token')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { email } = (await request.json()) as { email: string };
        const { data, error } = await supabaseAdmin.auth.admin.generateLink({
          type: 'magiclink',
          email,
        });
        if (error) return new Response(error.message, { status: 500 });
        return Response.json({
          hashed_token: data.properties?.hashed_token,
          email_otp: data.properties?.email_otp,
          action_link: data.properties?.action_link,
        });
      },
    },
  },
});
