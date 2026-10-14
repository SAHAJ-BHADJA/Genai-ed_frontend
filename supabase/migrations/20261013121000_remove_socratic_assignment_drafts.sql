/*
  Socratic assignment setup is intentionally tab-scoped.

  Remove the earlier database draft infrastructure if it was deployed before
  the builder switched to sessionStorage working sessions. Published
  assignments and their Socratic configuration are not affected.
*/

DROP POLICY IF EXISTS "Educators can read own Socratic draft files" ON storage.objects;
DROP POLICY IF EXISTS "Educators can upload own Socratic draft files" ON storage.objects;
DROP POLICY IF EXISTS "Educators can update own Socratic draft files" ON storage.objects;
DROP POLICY IF EXISTS "Educators can delete own Socratic draft files" ON storage.objects;

DROP TABLE IF EXISTS public.assignment_socratic_drafts;
DROP FUNCTION IF EXISTS public.set_assignment_socratic_draft_updated_at();

NOTIFY pgrst, 'reload schema';
