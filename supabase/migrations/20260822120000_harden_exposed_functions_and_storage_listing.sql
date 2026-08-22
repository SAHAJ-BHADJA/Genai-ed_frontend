/*
  Harden public functions and storage policies reported by Supabase Security
  Advisor without changing the application-facing RPC contract.

  Strategy:
  - trigger helpers receive an explicit, immutable search_path;
  - privileged function bodies move to a non-exposed schema;
  - public SECURITY INVOKER wrappers preserve every existing RPC signature;
  - anonymous execution is removed while authenticated and service-role calls
    continue to work;
  - broad bucket SELECT policies are replaced with scoped metadata policies to
    prevent bucket-wide listing while preserving authorized update/delete flows.
    Public object URLs continue to work because bucket visibility is unchanged.

  This migration is forward-only, data-preserving, and safe to re-run.
*/

BEGIN;

CREATE SCHEMA IF NOT EXISTS app_private;

REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA app_private TO authenticated, service_role;

-- Privileged implementations still resolve legacy unqualified table names in
-- public. Prevent API roles from creating shadow objects in that schema.
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;

-- This private authorization helper is used only by the public email resolver
-- wrapper. It prevents an authenticated student from using the RPC to resolve
-- arbitrary student email addresses while preserving educator and backend use.
CREATE OR REPLACE FUNCTION app_private.current_user_is_educator()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role = 'educator'
    );
$$;

REVOKE ALL ON FUNCTION app_private.current_user_is_educator() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.current_user_is_educator()
  TO authenticated, service_role;

-- Keep public in the fixed path for compatibility with trigger functions that
-- may reference application objects. API roles cannot create shadow objects in
-- public because CREATE was revoked above.
DO $$
BEGIN
  IF to_regprocedure('public.update_courses_updated_at()') IS NOT NULL THEN
    ALTER FUNCTION public.update_courses_updated_at()
      SET search_path = pg_catalog, public;
  END IF;

  IF to_regprocedure('public.update_lecture_artifacts_updated_at()') IS NOT NULL THEN
    ALTER FUNCTION public.update_lecture_artifacts_updated_at()
      SET search_path = pg_catalog, public;
  END IF;

  IF to_regprocedure('public.set_llm_playground_conversation_updated_at()') IS NOT NULL THEN
    ALTER FUNCTION public.set_llm_playground_conversation_updated_at()
      SET search_path = pg_catalog, public;
  END IF;
END;
$$;

/*
  Supabase exposes the public schema through PostgREST. SECURITY DEFINER
  functions therefore should not live there directly, even when their bodies
  already perform ownership checks.

  For every known application helper/RPC below, move the privileged body to
  app_private and recreate the exact public name and argument signature as a
  SECURITY INVOKER wrapper. Existing frontend .rpc(...) calls and RLS policy
  dependencies continue to work unchanged.
*/
DO $$
DECLARE
  function_record record;
  call_arguments text;
  declaration_arguments text;
  invocation_sql text;
  volatility_sql text;
BEGIN
  FOR function_record IN
    SELECT
      p.oid,
      p.proname,
      p.pronargs,
      pg_get_function_identity_arguments(p.oid) AS identity_arguments,
      pg_get_function_result(p.oid) AS result_type,
      CASE p.provolatile
        WHEN 'i' THEN 'IMMUTABLE'
        WHEN 's' THEN 'STABLE'
        ELSE 'VOLATILE'
      END AS volatility
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.proname = ANY (ARRAY[
        'can_modify_submission_files',
        'can_submit_assignment',
        'create_course_assignment',
        'current_auth_email',
        'get_course_lecture_analytics',
        'get_course_quiz_analytics',
        'get_course_student_performance',
        'get_course_student_roster',
        'get_student_course_assignments',
        'get_student_course_generated_quizzes',
        'is_assignment_educator',
        'is_assignment_visible_to_student',
        'is_course_educator',
        'is_course_student_owner',
        'is_socratic_assignment_student',
        'is_socratic_workspace_educator',
        'is_socratic_workspace_student_owner',
        'is_submission_visible_to_educator',
        'is_submission_visible_to_student',
        'resolve_student_profiles_by_emails',
        'rls_user_owns_course',
        'rls_user_owns_lecture',
        'sync_course_student_roster',
        'user_owns_lecture'
      ]::text[])
    ORDER BY p.oid
  LOOP
    SELECT string_agg(format('$%s', argument_number), ', ' ORDER BY argument_number)
    INTO call_arguments
    FROM generate_series(1, function_record.pronargs) AS argument_number;

    volatility_sql := function_record.volatility;
    declaration_arguments := function_record.identity_arguments;

    -- Preserve the only default argument currently exposed by these RPCs.
    -- Identity arguments intentionally omit defaults, but PostgREST callers may
    -- still rely on omitting this final assignment-targeting parameter.
    IF function_record.proname = 'create_course_assignment' THEN
      declaration_arguments := regexp_replace(
        declaration_arguments,
        '(p_target_course_student_ids uuid\[\])$',
        '\1 DEFAULT NULL'
      );
    END IF;

    -- Fix the implementation path before moving it out of the exposed schema.
    EXECUTE format(
      'ALTER FUNCTION public.%I(%s) SET search_path = pg_catalog, public',
      function_record.proname,
      function_record.identity_arguments
    );

    EXECUTE format(
      'ALTER FUNCTION public.%I(%s) SET SCHEMA app_private',
      function_record.proname,
      function_record.identity_arguments
    );

    EXECUTE format(
      'REVOKE ALL ON FUNCTION app_private.%I(%s) FROM PUBLIC, anon',
      function_record.proname,
      function_record.identity_arguments
    );

    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION app_private.%I(%s) TO authenticated, service_role',
      function_record.proname,
      function_record.identity_arguments
    );

    IF function_record.proname = 'resolve_student_profiles_by_emails' THEN
      invocation_sql := format(
        'SELECT resolved.* FROM app_private.%I(%s) AS resolved WHERE app_private.current_user_is_educator()',
        function_record.proname,
        call_arguments
      );
    ELSE
      invocation_sql := format(
        'SELECT * FROM app_private.%I(%s)',
        function_record.proname,
        call_arguments
      );
    END IF;

    EXECUTE format(
      'CREATE FUNCTION public.%I(%s) RETURNS %s LANGUAGE sql %s SECURITY INVOKER SET search_path = pg_catalog, app_private AS %L',
      function_record.proname,
      declaration_arguments,
      function_record.result_type,
      volatility_sql,
      invocation_sql
    );

    EXECUTE format(
      'REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon',
      function_record.proname,
      function_record.identity_arguments
    );

    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated, service_role',
      function_record.proname,
      function_record.identity_arguments
    );
  END LOOP;
END;
$$;

-- These broad SELECT policies allow bucket directory listing through the
-- Storage API. Public URL retrieval does not require them. Replace them with
-- scoped metadata access so legitimate update/delete operations still work.
DROP POLICY IF EXISTS "Allow public reads from course-files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view course files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view assignment files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view Socratic files" ON storage.objects;

DROP POLICY IF EXISTS "Authorized users can access course file metadata" ON storage.objects;
CREATE POLICY "Authorized users can access course file metadata"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'course-files'
    AND (
      owner = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.courses c
        WHERE c.id::text = (storage.foldername(name))[1]
          AND c.educator_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "Authorized users can access assignment file metadata" ON storage.objects;
CREATE POLICY "Authorized users can access assignment file metadata"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'assignment-files'
    AND (
      (
        (storage.foldername(name))[1] = 'assignment-questions'
        AND EXISTS (
          SELECT 1
          FROM public.assignments a
          WHERE a.id::text = (storage.foldername(name))[2]
            AND a.educator_id = auth.uid()
        )
      )
      OR (
        (storage.foldername(name))[1] = 'assignment-submissions'
        AND EXISTS (
          SELECT 1
          FROM public.assignment_students ast
          JOIN public.assignments a ON a.id = ast.assignment_id
          JOIN public.course_students cs ON cs.id = ast.course_student_id
          WHERE a.id::text = (storage.foldername(name))[2]
            AND cs.id::text = (storage.foldername(name))[3]
            AND (
              a.educator_id = auth.uid()
              OR cs.student_id = auth.uid()
              OR lower(cs.email) = lower(coalesce(auth.email(), ''))
            )
        )
      )
    )
  );

DROP POLICY IF EXISTS "Authorized users can access Socratic file metadata" ON storage.objects;
CREATE POLICY "Authorized users can access Socratic file metadata"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'socratic-writing'
    AND (
      EXISTS (
        SELECT 1
        FROM public.assignments a
        WHERE a.id::text = (storage.foldername(name))[1]
          AND a.educator_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.assignment_students ast
        JOIN public.course_students cs ON cs.id = ast.course_student_id
        WHERE ast.assignment_id::text = (storage.foldername(name))[1]
          AND cs.id::text = (storage.foldername(name))[2]
          AND (
            cs.student_id = auth.uid()
            OR lower(cs.email) = lower(coalesce(auth.email(), ''))
          )
      )
    )
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
