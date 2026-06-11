/*
  # Create Socratic Writing system

  1. Extend assignments
    - add experience_type metadata so standard and Socratic assignments can coexist

  2. New Socratic tables
    - assignment_socratic_configs
    - assignment_socratic_stage_questions
    - assignment_socratic_resources
    - assignment_socratic_student_workspaces
    - assignment_socratic_notes
    - assignment_socratic_ledger_entries
    - assignment_socratic_resource_progress
    - assignment_socratic_build_artifacts
    - assignment_socratic_essays
    - assignment_socratic_reviews

  3. Security
    - RLS policies for educators and assigned students

  4. Storage
    - socratic-writing bucket for future reading uploads / PDF artifacts
*/

ALTER TABLE public.assignments
  ADD COLUMN IF NOT EXISTS experience_type text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS experience_configured_at timestamptz,
  ADD COLUMN IF NOT EXISTS experience_version text NOT NULL DEFAULT 'v1';

ALTER TABLE public.assignments
  DROP CONSTRAINT IF EXISTS assignments_experience_type_check;

ALTER TABLE public.assignments
  ADD CONSTRAINT assignments_experience_type_check
  CHECK (experience_type IN ('standard', 'socratic_writing'));

CREATE TABLE IF NOT EXISTS public.assignment_socratic_configs (
  assignment_id uuid PRIMARY KEY REFERENCES public.assignments(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  educator_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  model_id text NOT NULL DEFAULT 'claude-opus-4.5',
  word_count integer NOT NULL DEFAULT 1500 CHECK (word_count > 0),
  clarify_ai_allowed boolean NOT NULL DEFAULT true,
  research_ai_allowed boolean NOT NULL DEFAULT true,
  build_ai_allowed boolean NOT NULL DEFAULT true,
  write_ai_allowed boolean NOT NULL DEFAULT true,
  clarify_system_prompt text NOT NULL DEFAULT '',
  research_system_prompt text NOT NULL DEFAULT '',
  build_system_prompt text NOT NULL DEFAULT '',
  write_system_prompt text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.assignment_socratic_stage_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('clarify', 'research', 'build', 'write')),
  question_text text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, stage, sort_order)
);

CREATE TABLE IF NOT EXISTS public.assignment_socratic_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  stage text NOT NULL DEFAULT 'research' CHECK (stage IN ('clarify', 'research', 'build', 'write')),
  resource_key text NOT NULL,
  resource_type text NOT NULL CHECK (resource_type IN ('reading', 'quiz', 'avatar_lecture', 'lecture', 'source')),
  resource_ref_id uuid,
  title text NOT NULL,
  summary text,
  resource_url text,
  storage_bucket text,
  storage_path text,
  required boolean NOT NULL DEFAULT false,
  created_from text NOT NULL DEFAULT 'existing' CHECK (created_from IN ('existing', 'new', 'upload')),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, resource_key)
);

CREATE TABLE IF NOT EXISTS public.assignment_socratic_student_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  course_student_id uuid NOT NULL REFERENCES public.course_students(id) ON DELETE CASCADE,
  student_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'submitted', 'graded', 'closed')),
  active_stage text NOT NULL DEFAULT 'clarify'
    CHECK (active_stage IN ('clarify', 'research', 'build', 'write')),
  clarify_status text NOT NULL DEFAULT 'not_started'
    CHECK (clarify_status IN ('not_started', 'in_progress', 'completed')),
  research_status text NOT NULL DEFAULT 'not_started'
    CHECK (research_status IN ('not_started', 'in_progress', 'completed')),
  build_status text NOT NULL DEFAULT 'not_started'
    CHECK (build_status IN ('not_started', 'in_progress', 'completed')),
  write_status text NOT NULL DEFAULT 'not_started'
    CHECK (write_status IN ('not_started', 'in_progress', 'completed')),
  clarify_draft text,
  research_coach_draft text,
  build_coach_draft text,
  write_coach_draft text,
  config_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  read_only_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, course_student_id)
);

CREATE TABLE IF NOT EXISTS public.assignment_socratic_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.assignment_socratic_student_workspaces(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  course_student_id uuid NOT NULL REFERENCES public.course_students(id) ON DELETE CASCADE,
  student_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  client_id text NOT NULL,
  origin_stage text NOT NULL CHECK (origin_stage IN ('clarify', 'research', 'build', 'write')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, client_id)
);

CREATE TABLE IF NOT EXISTS public.assignment_socratic_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.assignment_socratic_student_workspaces(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  course_student_id uuid NOT NULL REFERENCES public.course_students(id) ON DELETE CASCADE,
  student_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  client_id text NOT NULL,
  stage text NOT NULL CHECK (stage IN ('clarify', 'research', 'build', 'write')),
  actor text NOT NULL CHECK (actor IN ('student', 'ai', 'system')),
  entry_type text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, client_id)
);

CREATE TABLE IF NOT EXISTS public.assignment_socratic_resource_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.assignment_socratic_student_workspaces(id) ON DELETE CASCADE,
  resource_id uuid NOT NULL REFERENCES public.assignment_socratic_resources(id) ON DELETE CASCADE,
  opened boolean NOT NULL DEFAULT false,
  completed boolean NOT NULL DEFAULT false,
  manually_reviewed boolean NOT NULL DEFAULT false,
  opened_at timestamptz,
  completed_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, resource_id)
);

CREATE TABLE IF NOT EXISTS public.assignment_socratic_build_artifacts (
  workspace_id uuid PRIMARY KEY REFERENCES public.assignment_socratic_student_workspaces(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  course_student_id uuid NOT NULL REFERENCES public.course_students(id) ON DELETE CASCADE,
  thesis_options jsonb NOT NULL DEFAULT '[]'::jsonb,
  structure_plan jsonb NOT NULL DEFAULT '[]'::jsonb,
  stress_test_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.assignment_socratic_essays (
  workspace_id uuid PRIMARY KEY REFERENCES public.assignment_socratic_student_workspaces(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  course_student_id uuid NOT NULL REFERENCES public.course_students(id) ON DELETE CASCADE,
  editor_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  html text NOT NULL DEFAULT '',
  plain_text text NOT NULL DEFAULT '',
  pdf_url text,
  pdf_storage_path text,
  submitted_version integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.assignment_socratic_reviews (
  workspace_id uuid PRIMARY KEY REFERENCES public.assignment_socratic_student_workspaces(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  assignment_submission_id uuid REFERENCES public.assignment_submissions(id) ON DELETE SET NULL,
  grader_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  score numeric(6,2),
  feedback_text text,
  graded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assignment_socratic_configs_course_id
  ON public.assignment_socratic_configs(course_id);
CREATE INDEX IF NOT EXISTS idx_assignment_socratic_configs_educator_id
  ON public.assignment_socratic_configs(educator_id);
CREATE INDEX IF NOT EXISTS idx_assignment_socratic_stage_questions_assignment_id
  ON public.assignment_socratic_stage_questions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_assignment_socratic_resources_assignment_id
  ON public.assignment_socratic_resources(assignment_id);
CREATE INDEX IF NOT EXISTS idx_assignment_socratic_resources_ref
  ON public.assignment_socratic_resources(resource_ref_id);
CREATE INDEX IF NOT EXISTS idx_assignment_socratic_workspaces_assignment_id
  ON public.assignment_socratic_student_workspaces(assignment_id);
CREATE INDEX IF NOT EXISTS idx_assignment_socratic_workspaces_student_id
  ON public.assignment_socratic_student_workspaces(student_id);
CREATE INDEX IF NOT EXISTS idx_assignment_socratic_notes_workspace_id
  ON public.assignment_socratic_notes(workspace_id);
CREATE INDEX IF NOT EXISTS idx_assignment_socratic_ledger_workspace_id
  ON public.assignment_socratic_ledger_entries(workspace_id);
CREATE INDEX IF NOT EXISTS idx_assignment_socratic_ledger_created_at
  ON public.assignment_socratic_ledger_entries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assignment_socratic_resource_progress_workspace_id
  ON public.assignment_socratic_resource_progress(workspace_id);

ALTER TABLE public.assignment_socratic_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_socratic_stage_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_socratic_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_socratic_student_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_socratic_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_socratic_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_socratic_resource_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_socratic_build_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_socratic_essays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_socratic_reviews ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_socratic_assignment_student(p_assignment_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.assignment_students ast
    JOIN public.course_students cs
      ON cs.id = ast.course_student_id
    WHERE ast.assignment_id = p_assignment_id
      AND (
        cs.student_id = auth.uid()
        OR lower(cs.email) = lower(coalesce(auth.email(), ''))
      )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.is_socratic_workspace_student_owner(p_workspace_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.assignment_socratic_student_workspaces w
    JOIN public.course_students cs
      ON cs.id = w.course_student_id
    WHERE w.id = p_workspace_id
      AND (
        cs.student_id = auth.uid()
        OR lower(cs.email) = lower(coalesce(auth.email(), ''))
      )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.is_socratic_workspace_educator(p_workspace_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.assignment_socratic_student_workspaces w
    JOIN public.assignments a
      ON a.id = w.assignment_id
    WHERE w.id = p_workspace_id
      AND a.educator_id = auth.uid()
  );
END;
$$;

DROP POLICY IF EXISTS "Educators can manage Socratic configs" ON public.assignment_socratic_configs;
DROP POLICY IF EXISTS "Students can view visible Socratic configs" ON public.assignment_socratic_configs;
CREATE POLICY "Educators can manage Socratic configs"
  ON public.assignment_socratic_configs FOR ALL
  TO authenticated
  USING (is_assignment_educator(assignment_id))
  WITH CHECK (is_assignment_educator(assignment_id));
CREATE POLICY "Students can view visible Socratic configs"
  ON public.assignment_socratic_configs FOR SELECT
  TO authenticated
  USING (is_assignment_visible_to_student(assignment_id));

DROP POLICY IF EXISTS "Educators can manage Socratic stage questions" ON public.assignment_socratic_stage_questions;
DROP POLICY IF EXISTS "Students can view visible Socratic stage questions" ON public.assignment_socratic_stage_questions;
CREATE POLICY "Educators can manage Socratic stage questions"
  ON public.assignment_socratic_stage_questions FOR ALL
  TO authenticated
  USING (is_assignment_educator(assignment_id))
  WITH CHECK (is_assignment_educator(assignment_id));
CREATE POLICY "Students can view visible Socratic stage questions"
  ON public.assignment_socratic_stage_questions FOR SELECT
  TO authenticated
  USING (is_assignment_visible_to_student(assignment_id));

DROP POLICY IF EXISTS "Educators can manage Socratic resources" ON public.assignment_socratic_resources;
DROP POLICY IF EXISTS "Students can view visible Socratic resources" ON public.assignment_socratic_resources;
CREATE POLICY "Educators can manage Socratic resources"
  ON public.assignment_socratic_resources FOR ALL
  TO authenticated
  USING (is_assignment_educator(assignment_id))
  WITH CHECK (is_assignment_educator(assignment_id));
CREATE POLICY "Students can view visible Socratic resources"
  ON public.assignment_socratic_resources FOR SELECT
  TO authenticated
  USING (is_assignment_visible_to_student(assignment_id));

DROP POLICY IF EXISTS "Educators can view Socratic workspaces" ON public.assignment_socratic_student_workspaces;
DROP POLICY IF EXISTS "Students can manage own Socratic workspaces" ON public.assignment_socratic_student_workspaces;
CREATE POLICY "Educators can view Socratic workspaces"
  ON public.assignment_socratic_student_workspaces FOR SELECT
  TO authenticated
  USING (is_assignment_educator(assignment_id));
CREATE POLICY "Students can manage own Socratic workspaces"
  ON public.assignment_socratic_student_workspaces FOR ALL
  TO authenticated
  USING (is_course_student_owner(course_student_id))
  WITH CHECK (is_course_student_owner(course_student_id));

DROP POLICY IF EXISTS "Educators can view Socratic notes" ON public.assignment_socratic_notes;
DROP POLICY IF EXISTS "Students can manage own Socratic notes" ON public.assignment_socratic_notes;
CREATE POLICY "Educators can view Socratic notes"
  ON public.assignment_socratic_notes FOR SELECT
  TO authenticated
  USING (is_assignment_educator(assignment_id));
CREATE POLICY "Students can manage own Socratic notes"
  ON public.assignment_socratic_notes FOR ALL
  TO authenticated
  USING (is_course_student_owner(course_student_id))
  WITH CHECK (is_course_student_owner(course_student_id));

DROP POLICY IF EXISTS "Educators can view Socratic ledger" ON public.assignment_socratic_ledger_entries;
DROP POLICY IF EXISTS "Students can insert own Socratic ledger" ON public.assignment_socratic_ledger_entries;
DROP POLICY IF EXISTS "Students can view own Socratic ledger" ON public.assignment_socratic_ledger_entries;
CREATE POLICY "Educators can view Socratic ledger"
  ON public.assignment_socratic_ledger_entries FOR SELECT
  TO authenticated
  USING (is_assignment_educator(assignment_id));
CREATE POLICY "Students can insert own Socratic ledger"
  ON public.assignment_socratic_ledger_entries FOR INSERT
  TO authenticated
  WITH CHECK (is_course_student_owner(course_student_id));
CREATE POLICY "Students can view own Socratic ledger"
  ON public.assignment_socratic_ledger_entries FOR SELECT
  TO authenticated
  USING (is_course_student_owner(course_student_id));

DROP POLICY IF EXISTS "Educators can view Socratic resource progress" ON public.assignment_socratic_resource_progress;
DROP POLICY IF EXISTS "Students can manage own Socratic resource progress" ON public.assignment_socratic_resource_progress;
CREATE POLICY "Educators can view Socratic resource progress"
  ON public.assignment_socratic_resource_progress FOR SELECT
  TO authenticated
  USING (is_socratic_workspace_educator(workspace_id));
CREATE POLICY "Students can manage own Socratic resource progress"
  ON public.assignment_socratic_resource_progress FOR ALL
  TO authenticated
  USING (is_socratic_workspace_student_owner(workspace_id))
  WITH CHECK (is_socratic_workspace_student_owner(workspace_id));

DROP POLICY IF EXISTS "Educators can view Socratic build artifacts" ON public.assignment_socratic_build_artifacts;
DROP POLICY IF EXISTS "Students can manage own Socratic build artifacts" ON public.assignment_socratic_build_artifacts;
CREATE POLICY "Educators can view Socratic build artifacts"
  ON public.assignment_socratic_build_artifacts FOR SELECT
  TO authenticated
  USING (is_assignment_educator(assignment_id));
CREATE POLICY "Students can manage own Socratic build artifacts"
  ON public.assignment_socratic_build_artifacts FOR ALL
  TO authenticated
  USING (is_course_student_owner(course_student_id))
  WITH CHECK (is_course_student_owner(course_student_id));

DROP POLICY IF EXISTS "Educators can view Socratic essays" ON public.assignment_socratic_essays;
DROP POLICY IF EXISTS "Students can manage own Socratic essays" ON public.assignment_socratic_essays;
CREATE POLICY "Educators can view Socratic essays"
  ON public.assignment_socratic_essays FOR SELECT
  TO authenticated
  USING (is_assignment_educator(assignment_id));
CREATE POLICY "Students can manage own Socratic essays"
  ON public.assignment_socratic_essays FOR ALL
  TO authenticated
  USING (is_course_student_owner(course_student_id))
  WITH CHECK (is_course_student_owner(course_student_id));

DROP POLICY IF EXISTS "Educators can manage Socratic reviews" ON public.assignment_socratic_reviews;
DROP POLICY IF EXISTS "Students can view own Socratic reviews" ON public.assignment_socratic_reviews;
CREATE POLICY "Educators can manage Socratic reviews"
  ON public.assignment_socratic_reviews FOR ALL
  TO authenticated
  USING (is_assignment_educator(assignment_id))
  WITH CHECK (is_assignment_educator(assignment_id));
CREATE POLICY "Students can view own Socratic reviews"
  ON public.assignment_socratic_reviews FOR SELECT
  TO authenticated
  USING (is_socratic_workspace_student_owner(workspace_id));

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'socratic-writing',
  'socratic-writing',
  true,
  52428800,
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'image/jpeg',
    'image/png'
  ]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Authenticated users can view Socratic files" ON storage.objects;
DROP POLICY IF EXISTS "Educators can upload Socratic files" ON storage.objects;
DROP POLICY IF EXISTS "Students can upload Socratic files" ON storage.objects;
DROP POLICY IF EXISTS "Educators can delete Socratic files" ON storage.objects;
DROP POLICY IF EXISTS "Students can delete own Socratic files" ON storage.objects;

CREATE POLICY "Authenticated users can view Socratic files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'socratic-writing');

CREATE POLICY "Educators can upload Socratic files"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'socratic-writing'
    AND EXISTS (
      SELECT 1
      FROM public.assignments a
      WHERE a.id::text = (storage.foldername(name))[1]
        AND a.educator_id = auth.uid()
    )
  );

CREATE POLICY "Students can upload Socratic files"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'socratic-writing'
    AND EXISTS (
      SELECT 1
      FROM public.assignment_students ast
      JOIN public.course_students cs
        ON cs.id = ast.course_student_id
      WHERE ast.assignment_id::text = (storage.foldername(name))[1]
        AND cs.id::text = (storage.foldername(name))[2]
        AND (
          cs.student_id = auth.uid()
          OR lower(cs.email) = lower(coalesce(auth.email(), ''))
        )
    )
  );

CREATE POLICY "Educators can delete Socratic files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'socratic-writing'
    AND EXISTS (
      SELECT 1
      FROM public.assignments a
      WHERE a.id::text = (storage.foldername(name))[1]
        AND a.educator_id = auth.uid()
    )
  );

CREATE POLICY "Students can delete own Socratic files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'socratic-writing'
    AND EXISTS (
      SELECT 1
      FROM public.assignment_students ast
      JOIN public.course_students cs
        ON cs.id = ast.course_student_id
      WHERE ast.assignment_id::text = (storage.foldername(name))[1]
        AND cs.id::text = (storage.foldername(name))[2]
        AND (
          cs.student_id = auth.uid()
          OR lower(cs.email) = lower(coalesce(auth.email(), ''))
        )
    )
  );
