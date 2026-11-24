/*
  Use the authenticated user ID as the authoritative course-enrollment key.
  Keep a case-insensitive email fallback for legacy invitation rows that have
  not yet been linked to a profile ID.
*/

CREATE OR REPLACE FUNCTION public.is_enrolled_in_course(
  course_uuid uuid,
  user_email text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.course_students cs
    WHERE cs.course_id = course_uuid
      AND (
        cs.student_id = auth.uid()
        OR lower(trim(cs.email)) = lower(trim(coalesce(auth.email(), user_email, '')))
      )
  );
$$;

REVOKE ALL ON FUNCTION public.is_enrolled_in_course(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_enrolled_in_course(uuid, text) TO authenticated;

DROP POLICY IF EXISTS "Students can view their enrollments"
  ON public.course_students;
CREATE POLICY "Students can view their enrollments"
  ON public.course_students FOR SELECT
  TO authenticated
  USING (
    student_id = auth.uid()
    OR lower(trim(email)) = lower(trim(coalesce(auth.email(), '')))
  );
