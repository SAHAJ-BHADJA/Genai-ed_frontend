/*
  Restore row-level security on public objects flagged by Supabase.

  This migration is intentionally additive and idempotent:
  - it does not delete or rewrite application data;
  - service_role access continues to bypass RLS for backend workflows;
  - browser access is limited to the current student or owning educator;
  - the quiz target view evaluates permissions as the caller.
*/

-- Dedicated helpers avoid changing legacy application functions that may have
-- different parameter names or unqualified relation references.
CREATE OR REPLACE FUNCTION public.rls_user_owns_course(course_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.courses
    WHERE id = course_uuid
      AND educator_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.rls_user_owns_lecture(lecture_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.lectures
    WHERE id = lecture_uuid
      AND educator_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.rls_user_owns_course(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rls_user_owns_lecture(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rls_user_owns_course(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rls_user_owns_lecture(uuid) TO authenticated, service_role;

ALTER TABLE IF EXISTS public.course_teaching_assistants ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.course_textbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.student_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.student_lectures ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.student_lecture_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.quiz_batch_generated ENABLE ROW LEVEL SECURITY;

-- Course teaching assistants: owning educators manage the rows; an invited TA
-- may only see the row matching their authenticated email.
DROP POLICY IF EXISTS "Educators can view TAs for their courses" ON public.course_teaching_assistants;
DROP POLICY IF EXISTS "Educators can insert TAs for their courses" ON public.course_teaching_assistants;
DROP POLICY IF EXISTS "Educators can update TAs for their courses" ON public.course_teaching_assistants;
DROP POLICY IF EXISTS "Educators can delete TAs from their courses" ON public.course_teaching_assistants;
DROP POLICY IF EXISTS "Teaching assistants can view own course assignments" ON public.course_teaching_assistants;

CREATE POLICY "Educators can view TAs for their courses"
  ON public.course_teaching_assistants FOR SELECT
  TO authenticated
  USING (public.rls_user_owns_course(course_id));

CREATE POLICY "Educators can insert TAs for their courses"
  ON public.course_teaching_assistants FOR INSERT
  TO authenticated
  WITH CHECK (public.rls_user_owns_course(course_id));

CREATE POLICY "Educators can update TAs for their courses"
  ON public.course_teaching_assistants FOR UPDATE
  TO authenticated
  USING (public.rls_user_owns_course(course_id))
  WITH CHECK (public.rls_user_owns_course(course_id));

CREATE POLICY "Educators can delete TAs from their courses"
  ON public.course_teaching_assistants FOR DELETE
  TO authenticated
  USING (public.rls_user_owns_course(course_id));

CREATE POLICY "Teaching assistants can view own course assignments"
  ON public.course_teaching_assistants FOR SELECT
  TO authenticated
  USING (
    lower(email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
  );

-- Course textbooks are edited directly by the educator course screens.
DROP POLICY IF EXISTS "Educators can view textbooks for their courses" ON public.course_textbooks;
DROP POLICY IF EXISTS "Educators can insert textbooks for their courses" ON public.course_textbooks;
DROP POLICY IF EXISTS "Educators can update textbooks for their courses" ON public.course_textbooks;
DROP POLICY IF EXISTS "Educators can delete textbooks from their courses" ON public.course_textbooks;

CREATE POLICY "Educators can view textbooks for their courses"
  ON public.course_textbooks FOR SELECT
  TO authenticated
  USING (public.rls_user_owns_course(course_id));

CREATE POLICY "Educators can insert textbooks for their courses"
  ON public.course_textbooks FOR INSERT
  TO authenticated
  WITH CHECK (public.rls_user_owns_course(course_id));

CREATE POLICY "Educators can update textbooks for their courses"
  ON public.course_textbooks FOR UPDATE
  TO authenticated
  USING (public.rls_user_owns_course(course_id))
  WITH CHECK (public.rls_user_owns_course(course_id));

CREATE POLICY "Educators can delete textbooks from their courses"
  ON public.course_textbooks FOR DELETE
  TO authenticated
  USING (public.rls_user_owns_course(course_id));

-- Student uploads: students manage only their own files. Educators can read
-- uploads from courses they own, which preserves assignment resource selection.
DROP POLICY IF EXISTS "Students can view own uploads" ON public.student_uploads;
DROP POLICY IF EXISTS "Students can create own uploads" ON public.student_uploads;
DROP POLICY IF EXISTS "Students can update own uploads" ON public.student_uploads;
DROP POLICY IF EXISTS "Students can delete own uploads" ON public.student_uploads;
DROP POLICY IF EXISTS "Educators can view uploads for their courses" ON public.student_uploads;

CREATE POLICY "Students can view own uploads"
  ON public.student_uploads FOR SELECT
  TO authenticated
  USING (student_id = auth.uid());

CREATE POLICY "Students can create own uploads"
  ON public.student_uploads FOR INSERT
  TO authenticated
  WITH CHECK (student_id = auth.uid());

CREATE POLICY "Students can update own uploads"
  ON public.student_uploads FOR UPDATE
  TO authenticated
  USING (student_id = auth.uid())
  WITH CHECK (student_id = auth.uid());

CREATE POLICY "Students can delete own uploads"
  ON public.student_uploads FOR DELETE
  TO authenticated
  USING (student_id = auth.uid());

CREATE POLICY "Educators can view uploads for their courses"
  ON public.student_uploads FOR SELECT
  TO authenticated
  USING (public.rls_user_owns_course(course_id));

-- student_lectures has existed in two forms. Current databases use it as a
-- student-to-lecture access junction; older databases used it for
-- student-created lectures. Install policies for the detected schema so the
-- migration remains safe on both shapes.
DROP POLICY IF EXISTS "Students can view own lectures" ON public.student_lectures;
DROP POLICY IF EXISTS "Students can create own lectures" ON public.student_lectures;
DROP POLICY IF EXISTS "Students can update own lectures" ON public.student_lectures;
DROP POLICY IF EXISTS "Students can delete own lectures" ON public.student_lectures;
DROP POLICY IF EXISTS "Educators can view student lectures for their courses" ON public.student_lectures;
DROP POLICY IF EXISTS "Educators can view lecture access for own lectures" ON public.student_lectures;
DROP POLICY IF EXISTS "Educators can grant access to own lectures" ON public.student_lectures;
DROP POLICY IF EXISTS "Educators can update access to own lectures" ON public.student_lectures;
DROP POLICY IF EXISTS "Educators can revoke access to own lectures" ON public.student_lectures;

CREATE POLICY "Students can view own lectures"
  ON public.student_lectures FOR SELECT
  TO authenticated
  USING (student_id = auth.uid());

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'student_lectures'
      AND column_name = 'lecture_id'
  ) THEN
    -- In the current access-junction schema, students must not be able to grant
    -- themselves access to arbitrary lectures. Only the lecture owner manages
    -- these rows; students can read their own assignment through the policy
    -- above.
    EXECUTE $policy$
      CREATE POLICY "Educators can view lecture access for own lectures"
        ON public.student_lectures FOR SELECT
        TO authenticated
        USING (public.rls_user_owns_lecture(lecture_id))
    $policy$;

    EXECUTE $policy$
      CREATE POLICY "Educators can grant access to own lectures"
        ON public.student_lectures FOR INSERT
        TO authenticated
        WITH CHECK (public.rls_user_owns_lecture(lecture_id))
    $policy$;

    EXECUTE $policy$
      CREATE POLICY "Educators can update access to own lectures"
        ON public.student_lectures FOR UPDATE
        TO authenticated
        USING (public.rls_user_owns_lecture(lecture_id))
        WITH CHECK (public.rls_user_owns_lecture(lecture_id))
    $policy$;

    EXECUTE $policy$
      CREATE POLICY "Educators can revoke access to own lectures"
        ON public.student_lectures FOR DELETE
        TO authenticated
        USING (public.rls_user_owns_lecture(lecture_id))
    $policy$;
  ELSIF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'student_lectures'
      AND column_name = 'course_id'
  ) THEN
    -- Legacy student-created lecture rows remain writable only by their owner.
    EXECUTE $policy$
      CREATE POLICY "Students can create own lectures"
        ON public.student_lectures FOR INSERT
        TO authenticated
        WITH CHECK (student_id = auth.uid())
    $policy$;

    EXECUTE $policy$
      CREATE POLICY "Students can update own lectures"
        ON public.student_lectures FOR UPDATE
        TO authenticated
        USING (student_id = auth.uid())
        WITH CHECK (student_id = auth.uid())
    $policy$;

    EXECUTE $policy$
      CREATE POLICY "Students can delete own lectures"
        ON public.student_lectures FOR DELETE
        TO authenticated
        USING (student_id = auth.uid())
    $policy$;

    EXECUTE $policy$
      CREATE POLICY "Educators can view student lectures for their courses"
        ON public.student_lectures FOR SELECT
        TO authenticated
        USING (public.rls_user_owns_course(course_id))
    $policy$;
  ELSE
    RAISE EXCEPTION
      'Unsupported public.student_lectures schema: expected lecture_id or course_id';
  END IF;
END $$;

-- Lecture progress: students manage only their own progress. Educators may read
-- progress for lectures they own. Some historical databases also contain a
-- student_lecture_id column, so include that relationship only when present.
DROP POLICY IF EXISTS "Students can view own lecture views" ON public.student_lecture_views;
DROP POLICY IF EXISTS "Students can create own lecture views" ON public.student_lecture_views;
DROP POLICY IF EXISTS "Students can update own lecture views" ON public.student_lecture_views;
DROP POLICY IF EXISTS "Students can delete own lecture views" ON public.student_lecture_views;
DROP POLICY IF EXISTS "Educators can view progress for their lectures" ON public.student_lecture_views;

CREATE POLICY "Students can view own lecture views"
  ON public.student_lecture_views FOR SELECT
  TO authenticated
  USING (student_id = auth.uid());

CREATE POLICY "Students can create own lecture views"
  ON public.student_lecture_views FOR INSERT
  TO authenticated
  WITH CHECK (student_id = auth.uid());

CREATE POLICY "Students can update own lecture views"
  ON public.student_lecture_views FOR UPDATE
  TO authenticated
  USING (student_id = auth.uid())
  WITH CHECK (student_id = auth.uid());

CREATE POLICY "Students can delete own lecture views"
  ON public.student_lecture_views FOR DELETE
  TO authenticated
  USING (student_id = auth.uid());

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'student_lecture_views'
      AND column_name = 'student_lecture_id'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Educators can view progress for their lectures"
        ON public.student_lecture_views FOR SELECT
        TO authenticated
        USING (
          public.rls_user_owns_lecture(lecture_id)
          OR EXISTS (
            SELECT 1
            FROM public.student_lectures
            WHERE student_lectures.id = student_lecture_views.student_lecture_id
              AND public.rls_user_owns_course(student_lectures.course_id)
          )
        )
    $policy$;
  ELSE
    EXECUTE $policy$
      CREATE POLICY "Educators can view progress for their lectures"
        ON public.student_lecture_views FOR SELECT
        TO authenticated
        USING (public.rls_user_owns_lecture(lecture_id))
    $policy$;
  END IF;
END $$;

-- Generated quiz rows are visible only to the target student and the educator
-- who owns the parent batch. Mutations remain educator/backend operations.
DROP POLICY IF EXISTS "Students can view own generated quiz rows" ON public.quiz_batch_generated;
DROP POLICY IF EXISTS "Educators can view own generated quiz rows" ON public.quiz_batch_generated;
DROP POLICY IF EXISTS "Educators can insert own generated quiz rows" ON public.quiz_batch_generated;
DROP POLICY IF EXISTS "Educators can update own generated quiz rows" ON public.quiz_batch_generated;
DROP POLICY IF EXISTS "Educators can delete own generated quiz rows" ON public.quiz_batch_generated;

CREATE POLICY "Students can view own generated quiz rows"
  ON public.quiz_batch_generated FOR SELECT
  TO authenticated
  USING (student_id = auth.uid());

CREATE POLICY "Educators can view own generated quiz rows"
  ON public.quiz_batch_generated FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.quiz_batches
      WHERE quiz_batches.id = quiz_batch_generated.quiz_batch_id
        AND quiz_batches.educator_id = auth.uid()
    )
  );

CREATE POLICY "Educators can insert own generated quiz rows"
  ON public.quiz_batch_generated FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.quiz_batches
      WHERE quiz_batches.id = quiz_batch_generated.quiz_batch_id
        AND quiz_batches.educator_id = auth.uid()
    )
  );

CREATE POLICY "Educators can update own generated quiz rows"
  ON public.quiz_batch_generated FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.quiz_batches
      WHERE quiz_batches.id = quiz_batch_generated.quiz_batch_id
        AND quiz_batches.educator_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.quiz_batches
      WHERE quiz_batches.id = quiz_batch_generated.quiz_batch_id
        AND quiz_batches.educator_id = auth.uid()
    )
  );

CREATE POLICY "Educators can delete own generated quiz rows"
  ON public.quiz_batch_generated FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.quiz_batches
      WHERE quiz_batches.id = quiz_batch_generated.quiz_batch_id
        AND quiz_batches.educator_id = auth.uid()
    )
  );

-- PostgreSQL views otherwise use the view owner's privileges and can bypass the
-- caller's RLS. Supabase runs PostgreSQL 15+, where security_invoker is supported.
DO $$
BEGIN
  IF to_regclass('public.v_quiz_batch_targets') IS NOT NULL THEN
    ALTER VIEW public.v_quiz_batch_targets SET (security_invoker = true);
  END IF;
END $$;
