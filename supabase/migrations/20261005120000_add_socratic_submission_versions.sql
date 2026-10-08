-- Immutable Socratic submission packages and version-bound process reviews.

CREATE TABLE IF NOT EXISTS public.assignment_socratic_submission_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.assignment_socratic_student_workspaces(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  course_student_id uuid NOT NULL REFERENCES public.course_students(id) ON DELETE CASCADE,
  student_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assignment_submission_id uuid REFERENCES public.assignment_submissions(id) ON DELETE SET NULL,
  submission_version integer NOT NULL CHECK (submission_version > 0),
  essay_hash text NOT NULL,
  snapshot_json jsonb NOT NULL,
  quiz_kind text NOT NULL DEFAULT 'disabled'
    CHECK (quiz_kind IN ('individualized', 'diagnostic_fallback', 'generation_failed', 'disabled')),
  report_status text NOT NULL DEFAULT 'pending'
    CHECK (report_status IN ('pending', 'processing', 'ready', 'failed')),
  report_version integer NOT NULL DEFAULT 1 CHECK (report_version > 0),
  report_model_id text,
  report_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  report_text text,
  report_error text,
  report_attempts integer NOT NULL DEFAULT 0 CHECK (report_attempts >= 0),
  report_started_at timestamptz,
  report_generated_at timestamptz,
  submitted_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, submission_version)
);

CREATE INDEX IF NOT EXISTS idx_socratic_submission_snapshots_assignment
  ON public.assignment_socratic_submission_snapshots(assignment_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_socratic_submission_snapshots_workspace
  ON public.assignment_socratic_submission_snapshots(workspace_id, submission_version DESC);
CREATE INDEX IF NOT EXISTS idx_socratic_submission_snapshots_report_pending
  ON public.assignment_socratic_submission_snapshots(report_status, updated_at)
  WHERE report_status IN ('pending', 'processing', 'failed');

CREATE TABLE IF NOT EXISTS public.assignment_socratic_essay_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.assignment_socratic_student_workspaces(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  course_student_id uuid NOT NULL REFERENCES public.course_students(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  essay_hash text NOT NULL,
  plain_text text NOT NULL DEFAULT '',
  sanitized_html text NOT NULL DEFAULT '',
  word_count integer NOT NULL DEFAULT 0 CHECK (word_count >= 0),
  words_added integer NOT NULL DEFAULT 0 CHECK (words_added >= 0),
  words_removed integer NOT NULL DEFAULT 0 CHECK (words_removed >= 0),
  percent_changed numeric(7,2) NOT NULL DEFAULT 0,
  large_replacement boolean NOT NULL DEFAULT false,
  trigger_reason text NOT NULL DEFAULT 'meaningful_autosave',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, version_number),
  UNIQUE (workspace_id, essay_hash)
);

CREATE INDEX IF NOT EXISTS idx_socratic_essay_versions_workspace
  ON public.assignment_socratic_essay_versions(workspace_id, version_number DESC);

ALTER TABLE public.assignment_socratic_student_workspaces
  ADD COLUMN IF NOT EXISTS current_submission_snapshot_id uuid,
  ADD COLUMN IF NOT EXISTS current_submission_version integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  ALTER TABLE public.assignment_socratic_student_workspaces
    ADD CONSTRAINT assignment_socratic_workspaces_current_snapshot_fkey
    FOREIGN KEY (current_submission_snapshot_id)
    REFERENCES public.assignment_socratic_submission_snapshots(id)
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.assignment_socratic_reviews
  ADD COLUMN IF NOT EXISTS submission_snapshot_id uuid REFERENCES public.assignment_socratic_submission_snapshots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submission_version integer;

ALTER TABLE public.assignment_socratic_final_quizzes
  ADD COLUMN IF NOT EXISTS submission_snapshot_id uuid REFERENCES public.assignment_socratic_submission_snapshots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submission_version integer,
  ADD COLUMN IF NOT EXISTS report_version integer,
  ADD COLUMN IF NOT EXISTS quiz_kind text NOT NULL DEFAULT 'individualized';

DO $$
BEGIN
  ALTER TABLE public.assignment_socratic_final_quizzes
    ADD CONSTRAINT assignment_socratic_final_quizzes_quiz_kind_check
    CHECK (quiz_kind IN ('individualized', 'diagnostic_fallback', 'generation_failed', 'disabled'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.assignment_socratic_configs
  ALTER COLUMN model_id SET DEFAULT 'gpt-5.6-sol';

UPDATE public.assignment_socratic_configs
SET model_id = 'gpt-5.6-sol', updated_at = now()
WHERE model_id IS NULL OR model_id = '' OR model_id LIKE 'claude-%';

ALTER TABLE public.assignment_socratic_submission_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_socratic_essay_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Educators can view Socratic submission snapshots" ON public.assignment_socratic_submission_snapshots;
CREATE POLICY "Educators can view Socratic submission snapshots"
  ON public.assignment_socratic_submission_snapshots FOR SELECT
  TO authenticated
  USING (public.is_socratic_workspace_educator(workspace_id));

DROP POLICY IF EXISTS "Educators can view Socratic essay versions" ON public.assignment_socratic_essay_versions;
CREATE POLICY "Educators can view Socratic essay versions"
  ON public.assignment_socratic_essay_versions FOR SELECT
  TO authenticated
  USING (public.is_socratic_workspace_educator(workspace_id));

CREATE OR REPLACE FUNCTION public.create_socratic_submission_version(
  p_workspace_id uuid,
  p_student_id uuid,
  p_submission_text text,
  p_essay_hash text,
  p_snapshot_json jsonb,
  p_quiz_kind text,
  p_quiz_batch_id uuid,
  p_quiz_generated_id uuid,
  p_quiz_submitted_at timestamptz,
  p_system_issue text,
  p_submitted_at timestamptz
)
RETURNS public.assignment_socratic_submission_snapshots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_workspace public.assignment_socratic_student_workspaces%ROWTYPE;
  v_assignment public.assignments%ROWTYPE;
  v_submission public.assignment_submissions%ROWTYPE;
  v_snapshot public.assignment_socratic_submission_snapshots%ROWTYPE;
  v_version integer;
  v_submission_status text;
BEGIN
  IF p_quiz_kind NOT IN ('individualized', 'diagnostic_fallback', 'generation_failed', 'disabled') THEN
    RAISE EXCEPTION 'Invalid Socratic quiz kind';
  END IF;

  SELECT * INTO v_workspace
  FROM public.assignment_socratic_student_workspaces
  WHERE id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace not found';
  END IF;
  IF v_workspace.student_id IS NOT NULL AND v_workspace.student_id IS DISTINCT FROM p_student_id THEN
    RAISE EXCEPTION 'Workspace does not belong to this student';
  END IF;
  IF v_workspace.status IN ('graded', 'closed') OR v_workspace.read_only_at IS NOT NULL THEN
    RAISE EXCEPTION 'This Socratic studio is now read-only';
  END IF;

  SELECT * INTO v_assignment
  FROM public.assignments
  WHERE id = v_workspace.assignment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment not found';
  END IF;

  v_submission_status := CASE
    WHEN v_assignment.due_at IS NOT NULL AND v_assignment.due_at < p_submitted_at THEN 'late'
    ELSE 'submitted'
  END;

  INSERT INTO public.assignment_submissions (
    assignment_id, course_student_id, student_id, submission_text, status,
    submitted_at, is_late, updated_at
  ) VALUES (
    v_workspace.assignment_id, v_workspace.course_student_id, p_student_id,
    p_submission_text, v_submission_status, p_submitted_at,
    v_submission_status = 'late', p_submitted_at
  )
  ON CONFLICT (assignment_id, course_student_id) DO UPDATE SET
    student_id = EXCLUDED.student_id,
    submission_text = EXCLUDED.submission_text,
    status = EXCLUDED.status,
    submitted_at = EXCLUDED.submitted_at,
    is_late = EXCLUDED.is_late,
    grade_score = NULL,
    feedback_text = NULL,
    feedback_returned_at = NULL,
    grader_id = NULL,
    updated_at = EXCLUDED.updated_at
  RETURNING * INTO v_submission;

  SELECT coalesce(max(submission_version), 0) + 1 INTO v_version
  FROM public.assignment_socratic_submission_snapshots
  WHERE workspace_id = p_workspace_id;

  INSERT INTO public.assignment_socratic_submission_snapshots (
    workspace_id, assignment_id, course_student_id, student_id,
    assignment_submission_id, submission_version, essay_hash, snapshot_json,
    quiz_kind, report_status, report_version, submitted_at, updated_at
  ) VALUES (
    p_workspace_id, v_workspace.assignment_id, v_workspace.course_student_id, p_student_id,
    v_submission.id, v_version, p_essay_hash,
    p_snapshot_json || jsonb_build_object('submission_version', v_version, 'submitted_at', p_submitted_at),
    p_quiz_kind, 'pending', 1, p_submitted_at, p_submitted_at
  ) RETURNING * INTO v_snapshot;

  UPDATE public.assignment_socratic_student_workspaces SET
    student_id = coalesce(student_id, p_student_id),
    status = 'submitted',
    submitted_at = p_submitted_at,
    current_submission_snapshot_id = v_snapshot.id,
    current_submission_version = v_version,
    last_activity_at = p_submitted_at,
    updated_at = p_submitted_at
  WHERE id = p_workspace_id;

  INSERT INTO public.assignment_socratic_ledger_entries (
    workspace_id, assignment_id, course_student_id, student_id, client_id,
    stage, actor, entry_type, title, content, metadata, created_at
  ) VALUES (
    p_workspace_id, v_workspace.assignment_id, v_workspace.course_student_id, p_student_id,
    'submission-v' || v_version::text, 'write', 'system', 'submission',
    'Assignment submitted',
    'Socratic writing submission version ' || v_version::text || ' was saved as an immutable package.',
    jsonb_build_object(
      'assignmentSubmissionId', v_submission.id,
      'submissionSnapshotId', v_snapshot.id,
      'submissionVersion', v_version,
      'quizKind', p_quiz_kind,
      'systemIssue', p_system_issue
    ),
    p_submitted_at
  ) ON CONFLICT (workspace_id, client_id) DO NOTHING;

  INSERT INTO public.assignment_socratic_reviews (
    workspace_id, assignment_id, assignment_submission_id,
    submission_snapshot_id, submission_version, grader_id, score,
    feedback_text, graded_at, updated_at
  ) VALUES (
    p_workspace_id, v_workspace.assignment_id, v_submission.id,
    v_snapshot.id, v_version, NULL, NULL, NULL, NULL, p_submitted_at
  ) ON CONFLICT (workspace_id) DO UPDATE SET
    assignment_submission_id = EXCLUDED.assignment_submission_id,
    submission_snapshot_id = EXCLUDED.submission_snapshot_id,
    submission_version = EXCLUDED.submission_version,
    grader_id = NULL,
    score = NULL,
    feedback_text = NULL,
    graded_at = NULL,
    updated_at = EXCLUDED.updated_at;

  UPDATE public.assignment_socratic_final_quizzes SET
    status = CASE WHEN p_quiz_kind = 'generation_failed' THEN 'system_failed' ELSE 'submitted' END,
    report_status = NULL,
    report_json = '{}'::jsonb,
    report_text = NULL,
    report_generated_at = NULL,
    submission_snapshot_id = v_snapshot.id,
    submission_version = v_version,
    report_version = 1,
    quiz_kind = p_quiz_kind,
    quiz_batch_id = p_quiz_batch_id,
    quiz_generated_id = p_quiz_generated_id,
    quiz_submitted_at = p_quiz_submitted_at,
    system_issue = p_system_issue,
    finalized_at = p_submitted_at,
    updated_at = p_submitted_at
  WHERE workspace_id = p_workspace_id;

  RETURN v_snapshot;
END;
$$;

REVOKE ALL ON FUNCTION public.create_socratic_submission_version(
  uuid, uuid, text, text, jsonb, text, uuid, uuid, timestamptz, text, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_socratic_submission_version(
  uuid, uuid, text, text, jsonb, text, uuid, uuid, timestamptz, text, timestamptz
) TO service_role;

CREATE OR REPLACE FUNCTION public.grade_socratic_submission_version(
  p_workspace_id uuid,
  p_educator_id uuid,
  p_submission_snapshot_id uuid,
  p_score numeric,
  p_feedback text,
  p_graded_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_workspace public.assignment_socratic_student_workspaces%ROWTYPE;
  v_assignment public.assignments%ROWTYPE;
  v_snapshot public.assignment_socratic_submission_snapshots%ROWTYPE;
BEGIN
  SELECT * INTO v_workspace
  FROM public.assignment_socratic_student_workspaces
  WHERE id = p_workspace_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace not found';
  END IF;

  SELECT * INTO v_assignment FROM public.assignments WHERE id = v_workspace.assignment_id;
  IF NOT FOUND OR v_assignment.educator_id IS DISTINCT FROM p_educator_id THEN
    RAISE EXCEPTION 'Educator access is required';
  END IF;
  IF v_workspace.status NOT IN ('submitted', 'graded') THEN
    RAISE EXCEPTION 'Only a submitted Socratic workspace can be graded';
  END IF;

  SELECT * INTO v_snapshot
  FROM public.assignment_socratic_submission_snapshots
  WHERE id = p_submission_snapshot_id AND workspace_id = p_workspace_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A valid immutable submission version is required for grading';
  END IF;
  IF v_workspace.current_submission_snapshot_id IS DISTINCT FROM v_snapshot.id THEN
    RAISE EXCEPTION 'Only the current submission version can be graded';
  END IF;
  IF p_score IS NOT NULL AND (p_score < 0 OR p_score > coalesce(v_assignment.points_possible, 100)) THEN
    RAISE EXCEPTION 'Score must be between 0 and %', coalesce(v_assignment.points_possible, 100);
  END IF;

  INSERT INTO public.assignment_socratic_reviews (
    workspace_id, assignment_id, assignment_submission_id, submission_snapshot_id,
    submission_version, grader_id, score, feedback_text, graded_at, updated_at
  ) VALUES (
    p_workspace_id, v_assignment.id, v_snapshot.assignment_submission_id, v_snapshot.id,
    v_snapshot.submission_version, p_educator_id, p_score, nullif(btrim(p_feedback), ''),
    p_graded_at, p_graded_at
  ) ON CONFLICT (workspace_id) DO UPDATE SET
    assignment_submission_id = EXCLUDED.assignment_submission_id,
    submission_snapshot_id = EXCLUDED.submission_snapshot_id,
    submission_version = EXCLUDED.submission_version,
    grader_id = EXCLUDED.grader_id,
    score = EXCLUDED.score,
    feedback_text = EXCLUDED.feedback_text,
    graded_at = EXCLUDED.graded_at,
    updated_at = EXCLUDED.updated_at;

  UPDATE public.assignment_socratic_student_workspaces SET
    status = 'graded', read_only_at = p_graded_at, updated_at = p_graded_at
  WHERE id = p_workspace_id;

  UPDATE public.assignment_submissions SET
    grade_score = p_score,
    feedback_text = nullif(btrim(p_feedback), ''),
    feedback_returned_at = p_graded_at,
    grader_id = p_educator_id,
    status = 'graded',
    updated_at = p_graded_at
  WHERE id = v_snapshot.assignment_submission_id;

  RETURN jsonb_build_object(
    'workspaceId', p_workspace_id,
    'submissionSnapshotId', v_snapshot.id,
    'submissionVersion', v_snapshot.submission_version,
    'score', p_score,
    'feedback', nullif(btrim(p_feedback), ''),
    'gradedAt', p_graded_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.grade_socratic_submission_version(
  uuid, uuid, uuid, numeric, text, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grade_socratic_submission_version(
  uuid, uuid, uuid, numeric, text, timestamptz
) TO service_role;

NOTIFY pgrst, 'reload schema';
