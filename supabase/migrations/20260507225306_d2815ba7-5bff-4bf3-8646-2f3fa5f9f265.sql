-- Split couple_name_1 into first name + primary_client_last_name
UPDATE clients
SET 
  primary_client_last_name = NULLIF(substring(couple_name_1 FROM position(' ' IN couple_name_1) + 1), ''),
  couple_name_1 = split_part(couple_name_1, ' ', 1)
WHERE couple_name_1 LIKE '% %' 
  AND primary_client_last_name IS NULL;

-- Split couple_name_2 into first name + alternate_client_last_name
UPDATE clients
SET 
  alternate_client_last_name = NULLIF(substring(couple_name_2 FROM position(' ' IN couple_name_2) + 1), ''),
  couple_name_2 = split_part(couple_name_2, ' ', 1)
WHERE couple_name_2 LIKE '% %' 
  AND alternate_client_last_name IS NULL;