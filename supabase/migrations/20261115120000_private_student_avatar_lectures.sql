/*
  Private student avatar lectures

  Student-created media is stored separately from public educator media. The
  application backend is the only writer and issues short-lived signed URLs
  after verifying that the authenticated user created the lecture.
*/

ALTER TABLE public.lecture_artifacts
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS storage_bucket text NOT NULL DEFAULT 'lecture-assets',
  ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_lecture_artifacts_private_lecture
  ON public.lecture_artifacts (lecture_id, is_private, created_at DESC);

INSERT INTO storage.buckets (id, name, public)
VALUES ('student-lecture-assets', 'student-lecture-assets', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Do not create client storage policies for this bucket. The service role
-- uploads artifacts, and the owner-checked backend returns five-minute signed
-- URLs. This prevents classmates and educators from listing or signing files.

ALTER TABLE public.lecture_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lecture_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lecture_materials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own lecture jobs" ON public.lecture_jobs;
CREATE POLICY "Users can view own lecture jobs"
  ON public.lecture_jobs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.lectures l
      WHERE l.id = lecture_jobs.lecture_id
        AND (
          l.creator_user_id = auth.uid()
          OR (
            l.creator_role = 'educator'
            AND l.creator_user_id IS NULL
            AND l.educator_id = auth.uid()
          )
        )
    )
  );

DROP POLICY IF EXISTS "Users can view artifacts for their lectures" ON public.lecture_artifacts;
CREATE POLICY "Users can view artifacts for their lectures"
  ON public.lecture_artifacts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.lectures l
      WHERE l.id = lecture_artifacts.lecture_id
        AND (
          l.creator_user_id = auth.uid()
          OR (
            l.creator_role = 'educator'
            AND l.creator_user_id IS NULL
            AND l.educator_id = auth.uid()
          )
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.lectures l
      JOIN public.lecture_courses lc ON lc.lecture_id = l.id
      JOIN public.course_students cs ON cs.course_id = lc.course_id
      WHERE l.id = lecture_artifacts.lecture_id
        AND l.creator_role = 'educator'
        AND (
          cs.student_id = auth.uid()
          OR cs.email = auth.email()
        )
    )
  );

-- Enrolled students may read an educator's lecture materials, never another
-- student's private lecture materials.
DROP POLICY IF EXISTS "Students can view materials from enrolled courses" ON public.lecture_materials;
CREATE POLICY "Students can view materials from enrolled courses"
  ON public.lecture_materials FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.lectures l
      JOIN public.course_students cs
        ON cs.course_id = l.course_id
        OR cs.course_id = ANY(l.selected_course_ids)
      WHERE l.id = lecture_materials.lecture_id
        AND l.creator_role = 'educator'
        AND (
          cs.student_id = auth.uid()
          OR cs.email = auth.email()
        )
    )
  );

-- Remove any accidental direct access policies if this migration is reapplied
-- after experimentation. Signed URLs must come from the owner-checked API.
DROP POLICY IF EXISTS "Students can read private lecture assets" ON storage.objects;
DROP POLICY IF EXISTS "Students can upload private lecture assets" ON storage.objects;
DROP POLICY IF EXISTS "Students can update private lecture assets" ON storage.objects;
DROP POLICY IF EXISTS "Students can delete private lecture assets" ON storage.objects;

