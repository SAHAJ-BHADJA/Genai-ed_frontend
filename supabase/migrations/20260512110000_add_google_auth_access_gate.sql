/*
  # Add Google auth access gate metadata

  Existing profiles remain approved. New Google-created profiles are approved only
  after the access-code flow succeeds.
*/

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS auth_provider text NOT NULL DEFAULT 'password',
  ADD COLUMN IF NOT EXISTS is_access_approved boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS access_code_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS google_linked_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

UPDATE public.profiles
SET
  auth_provider = coalesce(nullif(auth_provider, ''), 'password'),
  is_access_approved = true
WHERE auth_provider is null
   OR auth_provider = ''
   OR is_access_approved IS DISTINCT FROM true;
