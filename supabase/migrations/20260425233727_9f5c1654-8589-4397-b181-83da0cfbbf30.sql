-- Profiles for existing auth users
INSERT INTO public.profiles (id, email, full_name, role) VALUES
  ('15f705ca-8003-467d-8b38-48b1795a6ba3', 'victoria@victoriaboustani.com', 'Victoria Boustani', 'owner'),
  ('56fb7740-2dde-4d64-a565-3ddd0c0afd89', 'dexter@storiesbyvictoria.com', 'Dexter Reyes', 'studio_manager')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, full_name = EXCLUDED.full_name;

-- Packages
INSERT INTO public.packages (name, description, base_price, default_hours, includes_engagement, includes_videography, includes_album, includes_second_shooter, display_order) VALUES
  ('The Storybook', 'An intimate wedding-day collection.', 7500, 8, true, false, false, false, 1),
  ('The Heirloom', 'Wedding day with film and a fine art album.', 12000, 10, true, true, true, false, 2),
  ('The Anthology', 'The complete heirloom experience with a second shooter.', 18000, 12, true, true, true, true, 3);

-- Clients (5 varied)
WITH pkgs AS (SELECT name, id FROM public.packages),
     vict AS (SELECT '15f705ca-8003-467d-8b38-48b1795a6ba3'::uuid AS id),
     dext AS (SELECT '56fb7740-2dde-4d64-a565-3ddd0c0afd89'::uuid AS id)
INSERT INTO public.clients (couple_name_1, couple_name_2, primary_email, phone, wedding_date, venue_name, venue_address, guest_count, package_id, package_price, has_engagement, has_videography, has_album, status, photographer_id, manager_id, last_contacted_at, inquiry_source) VALUES
  ('Olivia Bennett', 'Noah Carter', 'olivia.bennett@example.com', '+1 415-555-0148', NULL, NULL, NULL, NULL, NULL, NULL, false, false, false, 'lead', (SELECT id FROM vict), (SELECT id FROM dext), now() - interval '3 days', 'Instagram'),
  ('Amelia Hart', 'Liam Walsh', 'amelia.hart@example.com', '+1 212-555-0192', (CURRENT_DATE + interval '14 months')::date, 'The Glass Conservatory', '88 Hudson Yards, New York, NY', 140, NULL, NULL, true, false, false, 'lead', (SELECT id FROM vict), (SELECT id FROM dext), now() - interval '5 days', 'Referral'),
  ('Sophia Reyes', 'Ethan Marlowe', 'sophia.reyes@example.com', '+1 312-555-0173', (CURRENT_DATE + interval '9 months')::date, 'Cassine Gardens', '12 Vineyard Lane, Sonoma, CA', 110, (SELECT id FROM pkgs WHERE name='The Heirloom'), 12000, true, true, true, 'booked', (SELECT id FROM vict), (SELECT id FROM dext), now() - interval '2 days', 'Website'),
  ('Isabella Moreau', 'Henry Ashford', 'isabella.moreau@example.com', '+1 617-555-0125', (CURRENT_DATE + interval '5 weeks')::date, 'The Mayfair Estate', '2200 Beacon Hill, Boston, MA', 80, (SELECT id FROM pkgs WHERE name='The Storybook'), 7500, true, false, false, 'active', (SELECT id FROM vict), (SELECT id FROM dext), now() - interval '1 day', 'Referral'),
  ('Charlotte Vance', 'Julian Pierce', 'charlotte.vance@example.com', '+1 305-555-0167', (CURRENT_DATE + interval '3 months')::date, 'Villa Serena', '450 Coastline Drive, Miami, FL', 180, (SELECT id FROM pkgs WHERE name='The Anthology'), 18000, true, true, true, 'active', (SELECT id FROM vict), (SELECT id FROM dext), now() - interval '23 days', 'Press feature');

-- Tasks for Dexter
INSERT INTO public.tasks (assignee_id, client_id, title, description, due_date, status, priority)
SELECT
  '56fb7740-2dde-4d64-a565-3ddd0c0afd89'::uuid,
  (SELECT id FROM public.clients WHERE couple_name_1 = 'Sophia Reyes'),
  'Send timeline questionnaire to Sophia & Ethan',
  'Eight-week logistics form ahead of the wedding.',
  CURRENT_DATE, 'pending', 'high';

INSERT INTO public.tasks (assignee_id, client_id, title, description, due_date, status, priority)
SELECT
  '56fb7740-2dde-4d64-a565-3ddd0c0afd89'::uuid,
  (SELECT id FROM public.clients WHERE couple_name_1 = 'Isabella Moreau'),
  'Confirm final shot list with Isabella & Henry',
  'Wedding is five weeks out — confirm priority moments.',
  CURRENT_DATE + 3, 'pending', 'normal';

INSERT INTO public.tasks (assignee_id, client_id, title, description, due_date, status, priority)
SELECT
  '56fb7740-2dde-4d64-a565-3ddd0c0afd89'::uuid,
  (SELECT id FROM public.clients WHERE couple_name_1 = 'Charlotte Vance'),
  'Follow up with Charlotte & Julian',
  'No contact in 23 days — re-engage warmly.',
  CURRENT_DATE - 2, 'pending', 'high';