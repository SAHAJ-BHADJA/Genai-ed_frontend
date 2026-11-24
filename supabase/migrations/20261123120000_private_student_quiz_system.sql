/*
  Private student practice quizzes

  Student-created quizzes and attempts are isolated from educator quiz batches.
  Authenticated users may only read rows they created. All writes go through the
  owner-checking backend service, which uses the service role after validating
  the bearer token and course enrollment.
*/

CREATE TABLE IF NOT EXISTS public.student_private_quizzes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  quiz_name text NOT NULL,
  status text NOT NULL DEFAULT 'generated'
    CHECK (status IN ('generated', 'archived')),
  mcq_count integer NOT NULL DEFAULT 0
    CHECK (mcq_count BETWEEN 0 AND 30),
  short_answer_count integer NOT NULL DEFAULT 0
    CHECK (short_answer_count BETWEEN 0 AND 20),
  fixed_mcq_answer_key_enabled boolean NOT NULL DEFAULT false,
  fixed_mcq_answer_key jsonb,
  additional_instructions text,
  source_summary jsonb NOT NULL DEFAULT '[]'::jsonb,
  quiz_content_json jsonb NOT NULL,
  last_score_percent numeric(5,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (mcq_count + short_answer_count > 0),
  UNIQUE (id, creator_user_id)
);

-- Answer keys live separately from the owner-readable quiz row. There is no
-- authenticated SELECT policy on this table, so answers can only be retrieved
-- by the authenticated backend after the student submits an attempt.
CREATE TABLE IF NOT EXISTS public.student_private_quiz_answer_keys (
  quiz_id uuid PRIMARY KEY,
  creator_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  answer_content_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (quiz_id, creator_user_id)
    REFERENCES public.student_private_quizzes(id, creator_user_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.student_private_quiz_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id uuid NOT NULL
    REFERENCES public.student_private_quizzes(id) ON DELETE CASCADE,
  creator_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  submitted_answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  correct_count integer NOT NULL DEFAULT 0 CHECK (correct_count >= 0),
  total_scored_questions integer NOT NULL DEFAULT 0
    CHECK (total_scored_questions >= 0),
  score_percent numeric(5,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quiz_id, attempt_number),
  FOREIGN KEY (quiz_id, creator_user_id)
    REFERENCES public.student_private_quizzes(id, creator_user_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_student_private_quizzes_owner_created
  ON public.student_private_quizzes (creator_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_student_private_quizzes_owner_course
  ON public.student_private_quizzes (creator_user_id, course_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_student_private_quiz_attempts_owner_quiz
  ON public.student_private_quiz_attempts
  (creator_user_id, quiz_id, attempt_number DESC);

CREATE OR REPLACE FUNCTION public.touch_student_private_quiz_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_student_private_quiz_updated_at_trigger
  ON public.student_private_quizzes;
CREATE TRIGGER touch_student_private_quiz_updated_at_trigger
  BEFORE UPDATE ON public.student_private_quizzes
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_student_private_quiz_updated_at();

ALTER TABLE public.student_private_quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_private_quiz_answer_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_private_quiz_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students can view own private quizzes"
  ON public.student_private_quizzes;
CREATE POLICY "Students can view own private quizzes"
  ON public.student_private_quizzes FOR SELECT
  TO authenticated
  USING (creator_user_id = auth.uid());

DROP POLICY IF EXISTS "Students can view own private quiz attempts"
  ON public.student_private_quiz_attempts;
CREATE POLICY "Students can view own private quiz attempts"
  ON public.student_private_quiz_attempts FOR SELECT
  TO authenticated
  USING (
    creator_user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.student_private_quizzes quiz
      WHERE quiz.id = student_private_quiz_attempts.quiz_id
        AND quiz.creator_user_id = auth.uid()
    )
  );

-- Intentionally no authenticated policies at all for answer keys, and no
-- authenticated INSERT/UPDATE/DELETE policies for quizzes or attempts. The
-- backend is the only writer and the only answer-key reader after verifying
-- the bearer token, ownership, and course enrollment.

