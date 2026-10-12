/*
  # Educator student capability and protected test enrollments

  Educators keep their educator primary role, gain student capability on the
  same auth user, and receive an educator_test enrollment in every course they
  own. Test enrollments receive course work but are excluded from class-facing
  roster analytics.
*/

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS roles text[];

UPDATE public.profiles
SET roles = CASE
  WHEN role = 'educator' THEN ARRAY['educator', 'student']::text[]
  ELSE ARRAY['student']::text[]
END;

ALTER TABLE public.profiles
  ALTER COLUMN roles SET DEFAULT ARRAY['student']::text[],
  ALTER COLUMN roles SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_roles_valid_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_roles_valid_check
      CHECK (
        cardinality(roles) > 0
        AND roles <@ ARRAY['educator', 'student']::text[]
        AND 'student' = ANY(roles)
        AND (role <> 'educator' OR 'educator' = ANY(roles))
      );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_profile_roles()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $$
BEGIN
  IF NEW.role = 'educator' THEN
    NEW.roles := ARRAY['educator', 'student']::text[];
  ELSE
    NEW.roles := ARRAY['student']::text[];
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_profile_roles_trigger ON public.profiles;
CREATE TRIGGER normalize_profile_roles_trigger
  BEFORE INSERT OR UPDATE OF role, roles ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_profile_roles();

CREATE OR REPLACE FUNCTION public.profile_has_role(p_profile_id uuid, p_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_profile_id
      AND lower(trim(p_role)) = ANY(p.roles)
  );
$$;

REVOKE ALL ON FUNCTION public.profile_has_role(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.profile_has_role(uuid, text) TO authenticated;

-- Link any email invitations that predate the educator's new student
-- capability. The same auth UUID is used in both portal contexts.
UPDATE public.course_students cs
SET student_id = p.id
FROM public.profiles p
WHERE cs.student_id IS NULL
  AND lower(cs.email) = lower(p.email)
  AND public.profile_has_role(p.id, 'student');

UPDATE public.assignment_students ast
SET student_id = cs.student_id
FROM public.course_students cs
WHERE ast.course_student_id = cs.id
  AND ast.student_id IS NULL
  AND cs.student_id IS NOT NULL;

ALTER TABLE public.course_students
  ADD COLUMN IF NOT EXISTS enrollment_type text NOT NULL DEFAULT 'student';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'course_students_enrollment_type_check'
      AND conrelid = 'public.course_students'::regclass
  ) THEN
    ALTER TABLE public.course_students
      ADD CONSTRAINT course_students_enrollment_type_check
      CHECK (enrollment_type IN ('student', 'educator_test'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_course_students_enrollment_type
  ON public.course_students(course_id, enrollment_type);

CREATE OR REPLACE FUNCTION public.enroll_course_educator_as_test_student()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  educator_profile public.profiles%ROWTYPE;
BEGIN
  SELECT *
  INTO educator_profile
  FROM public.profiles
  WHERE id = NEW.educator_id;

  IF educator_profile.id IS NULL OR educator_profile.email IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.course_students (
    course_id,
    student_id,
    email,
    enrollment_type
  )
  VALUES (
    NEW.id,
    educator_profile.id,
    educator_profile.email,
    'educator_test'
  )
  ON CONFLICT ON CONSTRAINT course_students_course_id_email_key
  DO UPDATE SET
    student_id = EXCLUDED.student_id,
    enrollment_type = 'educator_test';

  INSERT INTO public.assignment_students (
    assignment_id,
    course_student_id,
    student_id,
    email
  )
  SELECT
    a.id,
    cs.id,
    cs.student_id,
    cs.email
  FROM public.assignments a
  JOIN public.course_students cs
    ON cs.course_id = a.course_id
   AND cs.enrollment_type = 'educator_test'
  WHERE a.course_id = NEW.id
  ON CONFLICT (assignment_id, course_student_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enroll_course_educator_as_test_student_trigger ON public.courses;
CREATE TRIGGER enroll_course_educator_as_test_student_trigger
  AFTER INSERT OR UPDATE OF educator_id ON public.courses
  FOR EACH ROW
  EXECUTE FUNCTION public.enroll_course_educator_as_test_student();

CREATE OR REPLACE FUNCTION public.enroll_existing_courses_for_educator()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF NEW.role <> 'educator' OR NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.course_students (
    course_id,
    student_id,
    email,
    enrollment_type
  )
  SELECT
    c.id,
    NEW.id,
    NEW.email,
    'educator_test'
  FROM public.courses c
  WHERE c.educator_id = NEW.id
  ON CONFLICT ON CONSTRAINT course_students_course_id_email_key
  DO UPDATE SET
    student_id = EXCLUDED.student_id,
    enrollment_type = 'educator_test';

  INSERT INTO public.assignment_students (
    assignment_id,
    course_student_id,
    student_id,
    email
  )
  SELECT
    a.id,
    cs.id,
    cs.student_id,
    cs.email
  FROM public.assignments a
  JOIN public.course_students cs
    ON cs.course_id = a.course_id
   AND cs.student_id = NEW.id
   AND cs.enrollment_type = 'educator_test'
  WHERE a.educator_id = NEW.id
  ON CONFLICT (assignment_id, course_student_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enroll_existing_courses_for_educator_trigger ON public.profiles;
CREATE TRIGGER enroll_existing_courses_for_educator_trigger
  AFTER INSERT OR UPDATE OF role, email ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enroll_existing_courses_for_educator();

INSERT INTO public.course_students (
  course_id,
  student_id,
  email,
  enrollment_type
)
SELECT
  c.id,
  p.id,
  p.email,
  'educator_test'
FROM public.courses c
JOIN public.profiles p
  ON p.id = c.educator_id
WHERE p.role = 'educator'
  AND p.email IS NOT NULL
ON CONFLICT ON CONSTRAINT course_students_course_id_email_key
DO UPDATE SET
  student_id = EXCLUDED.student_id,
  enrollment_type = 'educator_test';

-- Existing assignments predate the self-enrollment rows. Add the protected
-- educator test target so those assignments also appear in Student Workspace.
INSERT INTO public.assignment_students (
  assignment_id,
  course_student_id,
  student_id,
  email
)
SELECT
  a.id,
  cs.id,
  cs.student_id,
  cs.email
FROM public.assignments a
JOIN public.course_students cs
  ON cs.course_id = a.course_id
 AND cs.enrollment_type = 'educator_test'
ON CONFLICT (assignment_id, course_student_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.resolve_student_profiles_by_emails(p_emails text[])
RETURNS TABLE(email text, student_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT lower(p.email) AS email, p.id AS student_id
  FROM public.profiles p
  WHERE public.profile_has_role(p.id, 'student')
    AND lower(p.email) = ANY (
      SELECT lower(x) FROM unnest(p_emails) AS x
    );
$$;

REVOKE ALL ON FUNCTION public.resolve_student_profiles_by_emails(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_student_profiles_by_emails(text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_course_student_roster(p_course_id uuid, p_students jsonb)
RETURNS TABLE(
  course_student_id uuid,
  student_id uuid,
  email text,
  first_name text,
  last_name text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  missing_emails text[];
BEGIN
  IF NOT public.is_course_educator(p_course_id) THEN
    RAISE EXCEPTION 'Not authorized to update this course roster';
  END IF;

  IF p_students IS NULL OR jsonb_typeof(p_students) <> 'array' THEN
    RAISE EXCEPTION 'Students payload must be a JSON array';
  END IF;

  WITH requested AS (
    SELECT DISTINCT ON (lower(trim(coalesce(item->>'email', ''))))
      trim(coalesce(item->>'email', '')) AS req_email,
      lower(trim(coalesce(item->>'email', ''))) AS normalized_email,
      nullif(trim(coalesce(item->>'first_name', '')), '') AS req_first_name,
      nullif(trim(coalesce(item->>'last_name', '')), '') AS req_last_name
    FROM jsonb_array_elements(p_students) AS item
    WHERE trim(coalesce(item->>'email', '')) <> ''
  ),
  resolved AS (
    SELECT
      r.req_email,
      r.normalized_email,
      r.req_first_name,
      r.req_last_name,
      p.id AS resolved_student_id
    FROM requested r
    LEFT JOIN public.profiles p
      ON lower(p.email) = r.normalized_email
     AND public.profile_has_role(p.id, 'student')
  )
  SELECT array_agg(resolved.req_email ORDER BY resolved.req_email)
  INTO missing_emails
  FROM resolved
  WHERE resolved.resolved_student_id IS NULL;

  IF array_length(missing_emails, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'These students must sign up before they can be enrolled: %', array_to_string(missing_emails, ', ');
  END IF;

  WITH requested AS (
    SELECT DISTINCT ON (lower(trim(coalesce(item->>'email', ''))))
      trim(coalesce(item->>'email', '')) AS req_email,
      lower(trim(coalesce(item->>'email', ''))) AS normalized_email,
      nullif(trim(coalesce(item->>'first_name', '')), '') AS req_first_name,
      nullif(trim(coalesce(item->>'last_name', '')), '') AS req_last_name
    FROM jsonb_array_elements(p_students) AS item
    WHERE trim(coalesce(item->>'email', '')) <> ''
  ),
  resolved AS (
    SELECT
      r.req_email,
      r.normalized_email,
      r.req_first_name,
      r.req_last_name,
      p.id AS resolved_student_id
    FROM requested r
    JOIN public.profiles p
      ON lower(p.email) = r.normalized_email
     AND public.profile_has_role(p.id, 'student')
  )
  UPDATE public.profiles p
  SET
    first_name = coalesce(resolved.req_first_name, p.first_name),
    last_name = coalesce(resolved.req_last_name, p.last_name),
    full_name = nullif(
      trim(concat(
        coalesce(resolved.req_first_name, p.first_name, ''),
        ' ',
        coalesce(resolved.req_last_name, p.last_name, '')
      )),
      ''
    )
  FROM resolved
  WHERE p.id = resolved.resolved_student_id
    AND (
      resolved.req_first_name IS DISTINCT FROM p.first_name
      OR resolved.req_last_name IS DISTINCT FROM p.last_name
    );

  DELETE FROM public.course_students cs
  WHERE cs.course_id = p_course_id
    AND cs.enrollment_type = 'student'
    AND lower(cs.email) NOT IN (
      SELECT lower(trim(coalesce(item->>'email', '')))
      FROM jsonb_array_elements(p_students) AS item
      WHERE trim(coalesce(item->>'email', '')) <> ''
    );

  WITH requested AS (
    SELECT DISTINCT ON (lower(trim(coalesce(item->>'email', ''))))
      trim(coalesce(item->>'email', '')) AS req_email,
      lower(trim(coalesce(item->>'email', ''))) AS normalized_email
    FROM jsonb_array_elements(p_students) AS item
    WHERE trim(coalesce(item->>'email', '')) <> ''
  ),
  resolved AS (
    SELECT
      r.req_email,
      p.id AS resolved_student_id
    FROM requested r
    JOIN public.profiles p
      ON lower(p.email) = r.normalized_email
     AND public.profile_has_role(p.id, 'student')
  )
  INSERT INTO public.course_students (course_id, student_id, email, enrollment_type)
  SELECT
    p_course_id,
    resolved.resolved_student_id,
    resolved.req_email,
    'student'
  FROM resolved
  ON CONFLICT ON CONSTRAINT course_students_course_id_email_key
  DO UPDATE SET student_id = EXCLUDED.student_id;

  RETURN QUERY
  SELECT *
  FROM public.get_course_student_roster(p_course_id);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_course_student_roster(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_course_student_roster(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_course_lecture_analytics(p_course_id uuid)
RETURNS TABLE(
  lecture_id uuid,
  total_views bigint,
  completion_count bigint,
  completion_rate numeric,
  avg_watch_seconds numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_total_students integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.courses
    WHERE id = p_course_id AND educator_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized to view analytics for this course';
  END IF;

  SELECT count(*)
  INTO v_total_students
  FROM public.course_students
  WHERE course_id = p_course_id
    AND enrollment_type = 'student';

  RETURN QUERY
  SELECT
    l.id AS lecture_id,
    count(slv.id) AS total_views,
    count(*) FILTER (WHERE slv.completed) AS completion_count,
    CASE
      WHEN v_total_students > 0
        THEN round((count(*) FILTER (WHERE slv.completed)::numeric / v_total_students::numeric) * 100, 1)
      ELSE 0
    END AS completion_rate,
    round(coalesce(avg(slv.duration_watched), 0)::numeric, 1) AS avg_watch_seconds
  FROM public.lecture_courses lc
  JOIN public.lectures l ON l.id = lc.lecture_id
  LEFT JOIN public.student_lecture_views slv
    ON slv.lecture_id = l.id
   AND EXISTS (
     SELECT 1
     FROM public.course_students cs
     WHERE cs.course_id = p_course_id
       AND cs.student_id = slv.student_id
       AND cs.enrollment_type = 'student'
   )
  WHERE lc.course_id = p_course_id
    AND l.creator_role = 'educator'
  GROUP BY l.id
  ORDER BY l.id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_course_lecture_analytics(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_course_lecture_analytics(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_course_quiz_analytics(p_course_id uuid)
RETURNS TABLE(
  quiz_batch_id uuid,
  total_students integer,
  completed_count integer,
  pending_count integer,
  avg_score numeric,
  highest_score numeric,
  lowest_score numeric,
  excellent_count integer,
  good_count integer,
  fair_count integer,
  needs_improvement_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_total_students integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.courses
    WHERE id = p_course_id AND educator_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized to view analytics for this course';
  END IF;

  SELECT count(*)
  INTO v_total_students
  FROM public.course_students
  WHERE course_id = p_course_id
    AND enrollment_type = 'student';

  RETURN QUERY
  WITH course_batches AS (
    SELECT qb.id, qb.mode, qb.mcq_count, qb.short_answer_count
    FROM public.quiz_batch_courses qbc
    JOIN public.quiz_batches qb ON qb.id = qbc.quiz_batch_id
    WHERE qbc.course_id = p_course_id
      AND coalesce(qb.material_source_mode, '') <> 'socratic_final'
  ),
  generated_counts AS (
    SELECT qg.quiz_batch_id, count(*)::integer AS generated_count
    FROM public.quiz_generated qg
    JOIN course_batches cb ON cb.id = qg.quiz_batch_id
    JOIN public.course_students cs
      ON cs.course_id = p_course_id
     AND cs.student_id = qg.student_id
     AND cs.enrollment_type = 'student'
    GROUP BY qg.quiz_batch_id
  ),
  attempt_scores AS (
    SELECT
      qa.quiz_batch_id,
      CASE
        WHEN cb.mode = 'online' AND (cb.mcq_count + cb.short_answer_count) > 0
          THEN round(
            (coalesce(qa.final_score, qa.raw_score, 0)::numeric
              / (cb.mcq_count + cb.short_answer_count)::numeric) * 100,
            1
          )
        WHEN ((cb.mcq_count * 2) + (cb.short_answer_count * 5)) > 0
          THEN round(
            (coalesce(qa.final_score, qa.raw_score, 0)::numeric
              / ((cb.mcq_count * 2) + (cb.short_answer_count * 5))::numeric) * 100,
            1
          )
        ELSE NULL
      END AS score_pct,
      qa.status
    FROM public.quiz_attempts qa
    JOIN course_batches cb ON cb.id = qa.quiz_batch_id
    JOIN public.course_students cs
      ON cs.course_id = p_course_id
     AND cs.student_id = qa.student_id
     AND cs.enrollment_type = 'student'
  ),
  online_stats AS (
    SELECT
      attempt_scores.quiz_batch_id,
      count(*) FILTER (WHERE status IN ('submitted', 'timed_out', 'graded'))::integer AS completed_count,
      round(avg(score_pct)::numeric, 1) AS avg_score,
      round(max(score_pct)::numeric, 1) AS highest_score,
      round(min(score_pct)::numeric, 1) AS lowest_score,
      count(*) FILTER (WHERE score_pct >= 90)::integer AS excellent_count,
      count(*) FILTER (WHERE score_pct >= 80 AND score_pct < 90)::integer AS good_count,
      count(*) FILTER (WHERE score_pct >= 70 AND score_pct < 80)::integer AS fair_count,
      count(*) FILTER (WHERE score_pct < 70)::integer AS needs_improvement_count
    FROM attempt_scores
    GROUP BY attempt_scores.quiz_batch_id
  )
  SELECT
    cb.id AS quiz_batch_id,
    v_total_students AS total_students,
    CASE
      WHEN cb.mode = 'online' THEN coalesce(os.completed_count, 0)
      ELSE coalesce(gc.generated_count, 0)
    END AS completed_count,
    greatest(
      v_total_students - CASE
        WHEN cb.mode = 'online' THEN coalesce(os.completed_count, 0)
        ELSE coalesce(gc.generated_count, 0)
      END,
      0
    )::integer AS pending_count,
    os.avg_score,
    os.highest_score,
    os.lowest_score,
    coalesce(os.excellent_count, 0) AS excellent_count,
    coalesce(os.good_count, 0) AS good_count,
    coalesce(os.fair_count, 0) AS fair_count,
    coalesce(os.needs_improvement_count, 0) AS needs_improvement_count
  FROM course_batches cb
  LEFT JOIN generated_counts gc ON gc.quiz_batch_id = cb.id
  LEFT JOIN online_stats os ON os.quiz_batch_id = cb.id
  ORDER BY cb.id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_course_quiz_analytics(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_course_quiz_analytics(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_course_student_performance(p_course_id uuid)
RETURNS TABLE(
  course_student_id uuid,
  student_id uuid,
  email text,
  first_name text,
  last_name text,
  assignments_submitted integer,
  assignments_total integer,
  assignments_avg numeric,
  quizzes_completed integer,
  quizzes_total integer,
  quizzes_avg numeric,
  lectures_completed integer,
  lectures_total integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.courses
    WHERE id = p_course_id AND educator_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized to view analytics for this course';
  END IF;

  RETURN QUERY
  WITH roster AS (
    SELECT
      cs.id AS course_student_id,
      cs.student_id,
      coalesce(p.email, cs.email) AS email,
      p.first_name,
      p.last_name
    FROM public.course_students cs
    LEFT JOIN public.profiles p ON p.id = cs.student_id
    WHERE cs.course_id = p_course_id
      AND cs.enrollment_type = 'student'
  ),
  lecture_totals AS (
    SELECT count(*)::integer AS total
    FROM public.lecture_courses lc
    JOIN public.lectures l ON l.id = lc.lecture_id
    WHERE lc.course_id = p_course_id
      AND l.creator_role = 'educator'
  ),
  assignment_targets AS (
    SELECT ast.course_student_id, count(*)::integer AS total_assignments
    FROM public.assignment_students ast
    JOIN public.assignments a ON a.id = ast.assignment_id
    WHERE a.course_id = p_course_id
    GROUP BY ast.course_student_id
  ),
  assignment_scores AS (
    SELECT
      s.course_student_id,
      count(*) FILTER (WHERE s.submitted_at IS NOT NULL)::integer AS submitted_count,
      round(avg(
        CASE
          WHEN a.points_possible > 0 AND s.grade_score IS NOT NULL
            THEN (s.grade_score::numeric / a.points_possible::numeric) * 100
          ELSE NULL
        END
      )::numeric, 1) AS assignment_avg
    FROM public.assignment_submissions s
    JOIN public.assignments a ON a.id = s.assignment_id
    WHERE a.course_id = p_course_id
    GROUP BY s.course_student_id
  ),
  online_quiz_totals AS (
    SELECT count(*)::integer AS total
    FROM public.quiz_batch_courses qbc
    JOIN public.quiz_batches qb ON qb.id = qbc.quiz_batch_id
    WHERE qbc.course_id = p_course_id
      AND qb.mode = 'online'
      AND qb.status IN ('generated', 'saved', 'published')
      AND coalesce(qb.material_source_mode, '') <> 'socratic_final'
  ),
  online_quiz_scores AS (
    SELECT
      qa.student_id,
      count(*) FILTER (WHERE qa.status IN ('submitted', 'timed_out', 'graded'))::integer AS completed_count,
      round(avg(
        CASE
          WHEN (qb.mcq_count + qb.short_answer_count) > 0
            THEN (coalesce(qa.final_score, qa.raw_score, 0)::numeric
              / (qb.mcq_count + qb.short_answer_count)::numeric) * 100
          ELSE NULL
        END
      )::numeric, 1) AS quiz_avg
    FROM public.quiz_attempts qa
    JOIN public.quiz_batches qb ON qb.id = qa.quiz_batch_id
    JOIN public.quiz_batch_courses qbc ON qbc.quiz_batch_id = qb.id
    WHERE qbc.course_id = p_course_id
      AND qb.mode = 'online'
      AND coalesce(qb.material_source_mode, '') <> 'socratic_final'
    GROUP BY qa.student_id
  ),
  lecture_completion AS (
    SELECT
      slv.student_id,
      count(DISTINCT slv.lecture_id) FILTER (WHERE slv.completed)::integer AS completed_count
    FROM public.student_lecture_views slv
    JOIN public.lecture_courses lc ON lc.lecture_id = slv.lecture_id
    JOIN public.lectures l ON l.id = lc.lecture_id
    WHERE lc.course_id = p_course_id
      AND l.creator_role = 'educator'
    GROUP BY slv.student_id
  )
  SELECT
    r.course_student_id,
    r.student_id,
    r.email,
    r.first_name,
    r.last_name,
    coalesce(ascore.submitted_count, 0) AS assignments_submitted,
    coalesce(atarget.total_assignments, 0) AS assignments_total,
    ascore.assignment_avg AS assignments_avg,
    coalesce(qscore.completed_count, 0) AS quizzes_completed,
    coalesce(qtotal.total, 0) AS quizzes_total,
    qscore.quiz_avg AS quizzes_avg,
    coalesce(lc.completed_count, 0) AS lectures_completed,
    coalesce(lt.total, 0) AS lectures_total
  FROM roster r
  LEFT JOIN assignment_targets atarget ON atarget.course_student_id = r.course_student_id
  LEFT JOIN assignment_scores ascore ON ascore.course_student_id = r.course_student_id
  LEFT JOIN online_quiz_scores qscore ON qscore.student_id = r.student_id
  CROSS JOIN online_quiz_totals qtotal
  CROSS JOIN lecture_totals lt
  LEFT JOIN lecture_completion lc ON lc.student_id = r.student_id
  ORDER BY lower(coalesce(r.last_name, '')), lower(coalesce(r.first_name, '')), lower(r.email);
END;
$$;

REVOKE ALL ON FUNCTION public.get_course_student_performance(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_course_student_performance(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
