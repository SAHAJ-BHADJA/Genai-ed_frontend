/*
  Durable lecture media queue

  The web request only inserts/reuses queued lecture_jobs. Any number of backend
  workers may call this function; FOR UPDATE SKIP LOCKED guarantees that a job
  is claimed by only one worker. Queue metadata lives in the existing result
  JSONB column so this migration remains compatible with current deployments.
*/

CREATE INDEX IF NOT EXISTS idx_lecture_jobs_queue_claim
  ON public.lecture_jobs (status, updated_at, created_at);

-- Historical retry/client races may have left more than one active row for the
-- same output. Preserve the newest row and close older duplicates before adding
-- the invariant, otherwise an upgrade of an existing environment could fail.
WITH ranked_active_jobs AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY lecture_id, job_type
      ORDER BY created_at DESC, id DESC
    ) AS active_rank
  FROM public.lecture_jobs
  WHERE status IN ('queued', 'running')
)
UPDATE public.lecture_jobs AS duplicate_job
SET
  status = 'failed',
  progress = 100,
  error_message = 'Superseded by the durable generation queue migration.',
  updated_at = now(),
  result = COALESCE(duplicate_job.result, '{}'::jsonb) || jsonb_build_object(
    'stage', 'superseded',
    'superseded_at', now()
  )
FROM ranked_active_jobs
WHERE duplicate_job.id = ranked_active_jobs.id
  AND ranked_active_jobs.active_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lecture_jobs_one_active_media_type
  ON public.lecture_jobs (lecture_id, job_type)
  WHERE status IN ('queued', 'running');

-- Course lectures are authenticated course resources. Keep their objects
-- private and let the owner/enrollment-checked API issue short-lived URLs.
INSERT INTO storage.buckets (id, name, public)
VALUES ('lecture-assets', 'lecture-assets', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "Authenticated users can view lecture assets" ON storage.objects;

UPDATE public.lecture_artifacts
SET
  storage_bucket = 'lecture-assets',
  storage_path = CASE
    WHEN file_url LIKE '%/storage/v1/object/public/lecture-assets/%'
      THEN split_part(file_url, '/storage/v1/object/public/lecture-assets/', 2)
    WHEN file_url LIKE 'private://lecture-assets/%'
      THEN substring(file_url FROM length('private://lecture-assets/') + 1)
    ELSE storage_path
  END
WHERE COALESCE(is_private, false) = false
  AND storage_path IS NULL;

CREATE OR REPLACE FUNCTION public.claim_next_lecture_generation_job(
  p_worker_id text,
  p_stale_after_minutes integer DEFAULT 15
)
RETURNS SETOF public.lecture_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT job.id
    FROM public.lecture_jobs AS job
    WHERE (
        (
          job.status = 'queued'
          AND COALESCE(
            NULLIF(job.result ->> 'retry_after', '')::timestamptz,
            now()
          ) <= now()
        )
        OR (
          job.status = 'running'
          AND job.updated_at < now() - make_interval(
            mins => GREATEST(p_stale_after_minutes, 5)
          )
        )
      )
    AND COALESCE((job.result ->> 'attempt')::integer, 0)
      < COALESCE((job.result ->> 'max_attempts')::integer, 3)
    ORDER BY job.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.lecture_jobs AS claimed
  SET
    status = 'running',
    error_message = NULL,
    updated_at = now(),
    result = COALESCE(claimed.result, '{}'::jsonb) || jsonb_build_object(
      'attempt', COALESCE((claimed.result ->> 'attempt')::integer, 0) + 1,
      'max_attempts', COALESCE((claimed.result ->> 'max_attempts')::integer, 3),
      'worker_id', p_worker_id,
      'claim_token', gen_random_uuid()::text,
      'claimed_at', now(),
      'retry_after', NULL
    )
  FROM candidate
  WHERE claimed.id = candidate.id
  RETURNING claimed.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_lecture_generation_job(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_next_lecture_generation_job(text, integer) FROM anon;
REVOKE ALL ON FUNCTION public.claim_next_lecture_generation_job(text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_lecture_generation_job(text, integer) TO service_role;

-- Publish the lecture and replace its course links in one database transaction.
-- The status update also invokes the completeness trigger defined below.
CREATE OR REPLACE FUNCTION public.publish_generated_lecture(
  p_lecture_id uuid,
  p_owner_id uuid,
  p_course_ids uuid[],
  p_library_personal boolean DEFAULT false,
  p_library_usc boolean DEFAULT false
)
RETURNS SETOF public.lectures
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_lecture public.lectures%ROWTYPE;
  published_lecture public.lectures%ROWTYPE;
BEGIN
  IF COALESCE(array_length(p_course_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'At least one course is required to publish a lecture';
  END IF;

  SELECT *
  INTO target_lecture
  FROM public.lectures
  WHERE id = p_lecture_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lecture not found';
  END IF;

  IF target_lecture.creator_role = 'student'
    OR NOT (
      target_lecture.creator_user_id = p_owner_id
      OR (
        target_lecture.creator_user_id IS NULL
        AND target_lecture.educator_id = p_owner_id
      )
    )
  THEN
    RAISE EXCEPTION 'Only the educator who owns this lecture can publish it';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(p_course_ids) AS requested_course(course_id)
    LEFT JOIN public.courses AS owned_course
      ON owned_course.id = requested_course.course_id
      AND owned_course.educator_id = p_owner_id
    WHERE owned_course.id IS NULL
  ) THEN
    RAISE EXCEPTION 'A lecture can only be published to courses owned by its educator';
  END IF;

  DELETE FROM public.lecture_courses
  WHERE lecture_id = p_lecture_id;

  INSERT INTO public.lecture_courses (lecture_id, course_id)
  SELECT p_lecture_id, requested_course.course_id
  FROM unnest(p_course_ids) WITH ORDINALITY AS requested_course(course_id, position)
  GROUP BY requested_course.course_id
  ORDER BY min(requested_course.position);

  UPDATE public.lectures
  SET
    course_id = p_course_ids[1],
    selected_course_ids = p_course_ids,
    library_personal = p_library_personal,
    library_usc = p_library_usc,
    status = 'published'
  WHERE id = p_lecture_id
  RETURNING * INTO published_lecture;

  RETURN NEXT published_lecture;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_generated_lecture(
  uuid, uuid, uuid[], boolean, boolean
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publish_generated_lecture(
  uuid, uuid, uuid[], boolean, boolean
) FROM anon;
REVOKE ALL ON FUNCTION public.publish_generated_lecture(
  uuid, uuid, uuid[], boolean, boolean
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.publish_generated_lecture(
  uuid, uuid, uuid[], boolean, boolean
) TO service_role;

-- The API checks readiness before publishing, and this trigger closes the same
-- rule at the database boundary so a modified client cannot publish partial
-- output by updating the lectures table directly.
CREATE OR REPLACE FUNCTION public.enforce_complete_lecture_before_publish()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requested_styles jsonb := COALESCE(to_jsonb(NEW.content_style), '[]'::jsonb);
BEGIN
  IF NEW.status <> 'published' THEN
    RETURN NEW;
  END IF;

  IF NEW.creator_role = 'student' THEN
    RAISE EXCEPTION 'Private student lectures cannot be published';
  END IF;

  IF NOT (
    requested_styles ? 'audio'
    OR requested_styles ? 'powerpoint'
    OR requested_styles ? 'video'
  ) THEN
    RAISE EXCEPTION 'At least one lecture content style is required before publishing';
  END IF;

  IF EXISTS (
    WITH required(job_type, artifact_type) AS (
      SELECT 'audio', 'audio'
      WHERE requested_styles ? 'audio'
      UNION ALL
      SELECT 'pptx', 'pptx'
      WHERE requested_styles ? 'powerpoint'
      UNION ALL
      SELECT 'video_avatar', 'video_avatar'
      WHERE requested_styles ? 'video'
    )
    SELECT 1
    FROM required AS expected
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.lecture_jobs AS job
      WHERE job.lecture_id = NEW.id
        AND job.job_type = expected.job_type
        AND job.status = 'succeeded'
    )
    OR NOT EXISTS (
      SELECT 1
      FROM public.lecture_artifacts AS artifact
      WHERE artifact.lecture_id = NEW.id
        AND artifact.artifact_type = expected.artifact_type
        AND NULLIF(trim(artifact.file_url), '') IS NOT NULL
    )
  ) THEN
    RAISE EXCEPTION 'Every requested lecture artifact must succeed before publishing';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lectures_require_complete_generation_before_publish
  ON public.lectures;
CREATE TRIGGER lectures_require_complete_generation_before_publish
  BEFORE INSERT OR UPDATE OF status, content_style
  ON public.lectures
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_complete_lecture_before_publish();

