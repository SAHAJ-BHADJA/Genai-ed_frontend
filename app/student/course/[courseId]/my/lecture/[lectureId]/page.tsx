'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, FileText, Lock, Music, Presentation, RefreshCw, Video } from 'lucide-react';
import StudentLayout from '@/components/StudentLayout';
import { getBackendBase } from '@/lib/backend';
import { hasProfileRole } from '@/lib/profileRoles';
import { Profile, supabase } from '@/lib/supabase';

type PrivateLecture = {
  id: string;
  title: string;
  course_id: string;
  status: string;
  video_length: number | null;
  script_prompt: string | null;
  script_text: string | null;
  created_at: string;
};

type Course = {
  course_number: string;
  title: string;
};

type PrivateArtifact = {
  id: string;
  artifactType: 'video_avatar' | 'video_avatar_mp4' | 'audio' | 'audio_mp3' | 'pptx' | 'ppt';
  url: string;
  expiresIn: number;
  createdAt: string;
};

type MediaTab = 'video' | 'audio' | 'presentation';

const backendBase = getBackendBase().replace(/\/$/, '');

export default function StudentPrivateLectureViewer() {
  const router = useRouter();
  const params = useParams();
  const courseId = params.courseId as string;
  const lectureId = params.lectureId as string;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [lecture, setLecture] = useState<PrivateLecture | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [artifacts, setArtifacts] = useState<PrivateArtifact[]>([]);
  const [activeTab, setActiveTab] = useState<MediaTab>('video');
  const [error, setError] = useState<string | null>(null);

  const loadPrivateArtifacts = useCallback(async (accessToken: string) => {
    const response = await fetch(`${backendBase}/api/lectures/${lectureId}/private-artifacts`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });

    if (!response.ok) {
      if (response.status === 403 || response.status === 404) {
        throw new Error('This private lecture is not available to your account.');
      }
      throw new Error(await response.text());
    }

    const payload = await response.json();
    const nextArtifacts = (payload.artifacts || []) as PrivateArtifact[];
    setArtifacts(nextArtifacts);

    if (nextArtifacts.some((artifact) => artifact.artifactType === 'video_avatar' || artifact.artifactType === 'video_avatar_mp4')) {
      setActiveTab('video');
    } else if (nextArtifacts.some((artifact) => artifact.artifactType === 'audio' || artifact.artifactType === 'audio_mp3')) {
      setActiveTab('audio');
    } else if (nextArtifacts.some((artifact) => artifact.artifactType === 'pptx' || artifact.artifactType === 'ppt')) {
      setActiveTab('presentation');
    }
  }, [lectureId]);

  const loadLecture = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/student/login');
        return;
      }

      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (!profileData || !hasProfileRole(profileData, 'student')) {
        router.push('/');
        return;
      }
      setProfile(profileData);

      const { data: lectureData, error: lectureError } = await supabase
        .from('lectures')
        .select('id,title,course_id,status,video_length,script_prompt,script_text,created_at')
        .eq('id', lectureId)
        .eq('course_id', courseId)
        .eq('creator_role', 'student')
        .eq('creator_user_id', user.id)
        .maybeSingle();

      if (lectureError) throw lectureError;
      if (!lectureData) {
        setError('This private lecture is not available to your account.');
        return;
      }
      setLecture(lectureData as PrivateLecture);

      const { data: courseData } = await supabase
        .from('courses')
        .select('course_number,title')
        .eq('id', courseId)
        .maybeSingle();
      setCourse(courseData as Course | null);

      if (lectureData.status === 'completed' || lectureData.status === 'generated') {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error('Session expired. Please log in again.');
        await loadPrivateArtifacts(session.access_token);
      } else {
        setArtifacts([]);
      }
    } catch (loadError) {
      console.error('Error loading private lecture:', loadError);
      setError(loadError instanceof Error ? loadError.message : 'Unable to load this private lecture.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [courseId, lectureId, loadPrivateArtifacts, router]);

  useEffect(() => {
    void loadLecture();
  }, [loadLecture]);

  useEffect(() => {
    if (lecture?.status !== 'generating') return;
    const interval = window.setInterval(() => void loadLecture(), 5000);
    return () => window.clearInterval(interval);
  }, [lecture?.status, loadLecture]);

  useEffect(() => {
    if (!artifacts.length) return;
    const interval = window.setInterval(() => void loadLecture(), 4 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [artifacts.length, loadLecture]);

  const videoArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.artifactType === 'video_avatar' || artifact.artifactType === 'video_avatar_mp4'),
    [artifacts],
  );
  const audioArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.artifactType === 'audio' || artifact.artifactType === 'audio_mp3'),
    [artifacts],
  );
  const presentationArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.artifactType === 'pptx' || artifact.artifactType === 'ppt'),
    [artifacts],
  );

  if (loading || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-brand-maroon border-t-transparent" />
      </div>
    );
  }

  return (
    <StudentLayout profile={profile}>
      <div className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => router.push(`/student/course/${courseId}`)}
            className="flex items-center gap-2 text-brand-maroon hover:text-brand-maroon-hover"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to course
          </button>
          <button
            type="button"
            onClick={() => void loadLecture(true)}
            disabled={refreshing}
            className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">{error}</div>
        ) : lecture ? (
          <>
            <header className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800">
                  <Lock className="h-3.5 w-3.5" />
                  Private · Only you
                </span>
                <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold capitalize text-gray-700">
                  {lecture.status}
                </span>
              </div>
              <h1 className="text-3xl font-bold text-foreground">{lecture.title}</h1>
              <p className="mt-2 text-muted-foreground">
                {course?.course_number || 'Course'} · {lecture.video_length || 1} minute lecture
              </p>
              <p className="mt-3 flex items-center gap-2 text-sm text-blue-800">
                <Lock className="h-4 w-4" />
                Classmates and educators cannot access this lecture or its files.
              </p>
            </header>

            {lecture.status === 'generating' ? (
              <div className="rounded-2xl border border-border bg-card p-12 text-center">
                <div className="mx-auto mb-4 h-14 w-14 animate-spin rounded-full border-4 border-brand-maroon border-t-transparent" />
                <h2 className="text-lg font-semibold">Generating your private lecture</h2>
                <p className="mt-2 text-sm text-muted-foreground">Avatar video generation can take several minutes.</p>
              </div>
            ) : lecture.status === 'failed' ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center text-red-800">
                Generation failed. Return to Avatar Lecture Studio to review the configuration and try again.
              </div>
            ) : (
              <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
                <div className="mb-6 flex flex-wrap gap-2">
                  {videoArtifact && (
                    <button type="button" onClick={() => setActiveTab('video')} className={`rounded-lg px-4 py-2 text-sm font-semibold ${activeTab === 'video' ? 'bg-brand-maroon text-white' : 'bg-muted text-foreground'}`}>
                      <Video className="mr-2 inline h-4 w-4" />Video
                    </button>
                  )}
                  {audioArtifact && (
                    <button type="button" onClick={() => setActiveTab('audio')} className={`rounded-lg px-4 py-2 text-sm font-semibold ${activeTab === 'audio' ? 'bg-brand-maroon text-white' : 'bg-muted text-foreground'}`}>
                      <Music className="mr-2 inline h-4 w-4" />Audio
                    </button>
                  )}
                  {presentationArtifact && (
                    <button type="button" onClick={() => setActiveTab('presentation')} className={`rounded-lg px-4 py-2 text-sm font-semibold ${activeTab === 'presentation' ? 'bg-brand-maroon text-white' : 'bg-muted text-foreground'}`}>
                      <Presentation className="mr-2 inline h-4 w-4" />Slides
                    </button>
                  )}
                </div>

                {activeTab === 'video' && videoArtifact && (
                  <video key={videoArtifact.url} controls className="aspect-video w-full rounded-xl bg-black" src={videoArtifact.url}>
                    Your browser does not support the video tag.
                  </video>
                )}
                {activeTab === 'audio' && audioArtifact && (
                  <div className="rounded-xl bg-muted p-8">
                    <audio key={audioArtifact.url} controls className="w-full" src={audioArtifact.url} />
                  </div>
                )}
                {activeTab === 'presentation' && presentationArtifact && (
                  <div className="rounded-xl border border-border p-10 text-center">
                    <Presentation className="mx-auto mb-4 h-14 w-14 text-brand-maroon" />
                    <a href={presentationArtifact.url} target="_blank" rel="noreferrer" className="font-semibold text-brand-maroon hover:underline">
                      Open private presentation
                    </a>
                  </div>
                )}

                {!artifacts.length && (
                  <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
                    No generated files are available yet.
                  </div>
                )}
              </div>
            )}

            <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
                <FileText className="h-5 w-5" />
                Lecture prompt
              </h2>
              <p className="whitespace-pre-wrap text-muted-foreground">
                {lecture.script_prompt || 'A directly provided script was used for this lecture.'}
              </p>
            </section>
          </>
        ) : null}
      </div>
    </StudentLayout>
  );
}
