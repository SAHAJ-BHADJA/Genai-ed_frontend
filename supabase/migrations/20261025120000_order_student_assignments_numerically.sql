/*
  Keep student assignment cards in their course sequence (Assignment 1, 2, 3, ...).

  The previous RPC ordered assignments by due timestamp. Assignments with the same
  due date could therefore appear as 1, 3, 4, 2 when their due times differed.
*/

CREATE OR REPLACE FUNCTION app_private.get_student_course_assignments(p_course_id uuid)
RETURNS TABLE (
  id uuid,
  course_id uuid,
  assignment_label text,
  assignment_title text,
  description text,
  question_file_name text,
  question_pdf_url text,
  question_storage_path text,
  points_possible integer,
  status text,
  submission_mode text,
  allowed_mime_types jsonb,
  max_file_size_bytes bigint,
  max_files integer,
  available_at timestamptz,
  due_at timestamptz,
  late_until timestamptz,
  created_at timestamptz,
  submission_id uuid,
  submission_status text,
  submitted_at timestamptz,
  submission_text text,
  is_late boolean,
  grade_score numeric,
  feedback_text text,
  feedback_returned_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.course_students cs
    WHERE cs.course_id = p_course_id
      AND (
        cs.student_id = auth.uid()
        OR lower(cs.email) = lower(coalesce(auth.email(), ''))
      )
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.course_id,
    a.assignment_label,
    a.assignment_title,
    a.description,
    a.question_file_name,
    a.question_pdf_url,
    a.question_storage_path,
    a.points_possible,
    a.status,
    a.submission_mode,
    a.allowed_mime_types,
    a.max_file_size_bytes,
    a.max_files,
    a.available_at,
    a.due_at,
    a.late_until,
    a.created_at,
    s.id AS submission_id,
    s.status AS submission_status,
    s.submitted_at,
    s.submission_text,
    s.is_late,
    s.grade_score,
    s.feedback_text,
    s.feedback_returned_at
  FROM public.assignments a
  JOIN public.assignment_students ast
    ON ast.assignment_id = a.id
  JOIN public.course_students cs
    ON cs.id = ast.course_student_id
  LEFT JOIN public.assignment_submissions s
    ON s.assignment_id = a.id
   AND s.course_student_id = ast.course_student_id
  WHERE a.course_id = p_course_id
    AND a.status IN ('published', 'closed')
    AND (a.available_at IS NULL OR a.available_at <= now())
    AND (
      cs.student_id = auth.uid()
      OR lower(cs.email) = lower(coalesce(auth.email(), ''))
    )
  ORDER BY a.assignment_number ASC, a.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION app_private.get_student_course_assignments(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.get_student_course_assignments(uuid) TO authenticated, service_role;
