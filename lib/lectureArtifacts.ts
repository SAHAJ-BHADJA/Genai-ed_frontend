import { getBackendBase } from '@/lib/backend';
import { supabase } from '@/lib/supabase';

export type AuthorizedLectureArtifact = {
  id: string;
  artifact_type: string;
  file_url: string;
  storage_path: string;
  storage_bucket: string;
  is_private: boolean;
  created_at: string;
  expires_in: number;
};

const backendUrl = getBackendBase().replace(/\/$/, '');

export async function fetchLectureArtifacts(
  lectureId: string,
): Promise<AuthorizedLectureArtifact[]> {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session?.access_token) throw new Error('Session expired. Please log in again.');

  const response = await fetch(`${backendUrl}/api/lectures/${lectureId}/artifacts`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: 'no-store',
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(payload?.detail || `Unable to load lecture artifacts (${response.status}).`);
  }
  const payload = await response.json();
  return (payload.artifacts || []) as AuthorizedLectureArtifact[];
}

