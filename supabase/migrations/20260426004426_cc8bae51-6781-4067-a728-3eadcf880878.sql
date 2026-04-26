
CREATE OR REPLACE FUNCTION public._branch_passes(p_branch public.workflow_branch, p_client public.clients) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  RETURN CASE p_branch
    WHEN 'always' THEN true
    WHEN 'has_engagement' THEN COALESCE(p_client.has_engagement,false)
    WHEN 'has_videography' THEN COALESCE(p_client.has_videography,false)
    WHEN 'has_album' THEN COALESCE(p_client.has_album,false)
    WHEN 'has_album_active' THEN COALESCE(p_client.album_workflow_active,false)
    WHEN 'NOT_has_album_purchased' THEN NOT COALESCE(p_client.has_album,false)
    ELSE false
  END;
END; $$;
