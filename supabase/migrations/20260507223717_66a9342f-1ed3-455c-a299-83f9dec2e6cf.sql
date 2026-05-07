ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS primary_client_last_name text,
  ADD COLUMN IF NOT EXISTS alternate_client_last_name text,
  ADD COLUMN IF NOT EXISTS primary_client_phone text,
  ADD COLUMN IF NOT EXISTS alternate_client_phone text,
  ADD COLUMN IF NOT EXISTS shared_street_address text,
  ADD COLUMN IF NOT EXISTS shared_city text,
  ADD COLUMN IF NOT EXISTS shared_state text,
  ADD COLUMN IF NOT EXISTS shared_zipcode text;

COMMENT ON COLUMN clients.primary_client_last_name IS 'Last name of primary client (couple_name_1 is their first name)';
COMMENT ON COLUMN clients.alternate_client_last_name IS 'Last name of alternate client (couple_name_2 is their first name)';
COMMENT ON COLUMN clients.shared_street_address IS 'Couple shared home address - street line';
COMMENT ON COLUMN clients.shared_city IS 'Couple shared home city';
COMMENT ON COLUMN clients.shared_state IS 'Couple shared home state (2-letter)';
COMMENT ON COLUMN clients.shared_zipcode IS 'Couple shared home postal code';