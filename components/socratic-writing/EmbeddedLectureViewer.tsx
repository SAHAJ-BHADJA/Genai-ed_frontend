'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Profile, supabase } from '@/lib/supabase';
import { hasProfileRole } from '@/lib/profileRoles';
import { Clock, Download, FileText, Loader2, Music, Presentation, User, Video } from 'lucide-react';

interface Lecture {
  id: string;
  title: string;
  description: string;
  video_url: string | null;
  video_length: number;
  course_id: string;
  status: string;
  script_text: string | null;
  creator_role: string;
}

interface Course {
  course_number: string;
  title: string;
  instructor_name: string;
}

interface Artifact {
  id: string;
  artifact_type: 'audio_mp3' | 'audio' | 'pptx' | 'ppt' | 'video_static_mp4' | 'video_avatar_mp4' | 'video_avatar';
  file_url: string;
  created_at: string;
}

type EmbeddedLectureViewerProps = {
  courseId: string;
  lectureId: string;
  previewMode?: boolean;
  onProgressChange?: (state: { opened: boolean; completed: boolean }) => void;
};

export default function EmbeddedLectureViewer({
  courseId,
  lectureId,
  previewMode = false,
  onProgressChange,
}: EmbeddedLectureViewerProps) {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [activeTab, setActiveTab] = useState<'video' | 'audio' | 'presentation'>('video');
  const [error, setError] = useState<string | null>(null);
  const [assetNotice, setAssetNotice] = useState<string | null>(null);
  const [viewCompleted, setViewCompleted] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const [standaloneVideoUrl, setStandaloneVideoUrl] = useState<string | null>(null);

  const currentTimeRef = useRef(0);
  const lastSyncedSecondsRef = useRef(0);

  useEffect(() => {
    void loadLectureData();
  }, [lectureId]);

  useEffect(() => {
    if (previewMode) return;
    onProgressChange?.({
      opened: Boolean(lecture),
      completed: viewCompleted,
    });
  }, [lecture?.id, onProgressChange, previewMode, viewCompleted]);

  const videoArtifact = useMemo(
    () => artifacts.find((a) => a.artifact_type === 'video_avatar_mp4' || a.artifact_type === 'video_static_mp4' || a.artifact_type === 'video_avatar') || null,
    [artifacts],
  );
  const audioArtifact = useMemo(
    () => artifacts.find((a) => a.artifact_type === 'audio_mp3' || a.artifact_type === 'audio') || null,
    [artifacts],
  );
  const slidesArtifact = useMemo(
    () => artifacts.find((a) => a.artifact_type === 'pptx' || a.artifact_type === 'ppt') || null,
    [artifacts],
  );

  const probePublicAssetUrl = async (url: string | null | undefined) => {
    if (!url) return false;

    try {
      const headResponse = await fetch(url, {
        method: 'HEAD',
        cache: 'no-store',
      });
      if (headResponse.ok) return true;
    } catch {
      // Fall back to a small GET below.
    }

    try {
      const getResponse = await fetch(url, {
        method: 'GET',
        headers: {
          Range: 'bytes=0-0',
        },
        cache: 'no-store',
      });
      return getResponse.ok;
    } catch {
      return false;
    }
  };

  const loadLectureData = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setError('Please sign in again to continue.');
        return;
      }

      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (!profileData) {
        setError('Unable to confirm your profile for this lecture.');
        return;
      }

      const isEducatorPreview = previewMode && hasProfileRole(profileData, 'educator');
      if (!isEducatorPreview && !hasProfileRole(profileData, 'student')) {
        setError('Student access is required to view this lecture.');
        return;
      }

      setProfile(profileData);

      if (!isEducatorPreview) {
        const { data: enrollmentCheck } = await supabase
          .from('course_students')
          .select('course_id')
          .eq('email', user.email!)
          .eq('course_id', courseId)
          .maybeSingle();

        if (!enrollmentCheck) {
          setError('You are not enrolled in this course.');
          return;
        }
      }

      const { data: lectureCourseCheck } = await supabase
        .from('lecture_courses')
        .select('lecture_id')
        .eq('course_id', courseId)
        .eq('lecture_id', lectureId)
        .maybeSingle();

      if (!lectureCourseCheck) {
        setError('This lecture is not available in the current course.');
        return;
      }

      const { data: lectureData } = await supabase
        .from('lectures')
        .select('*')
        .eq('id', lectureId)
        .eq('creator_role', 'educator')
        .maybeSingle();

      if (!lectureData || (lectureData.status !== 'completed' && lectureData.status !== 'published')) {
        setError('This lecture is not available yet.');
        return;
      }

      setLecture(lectureData);
      const hasStandaloneVideo = await probePublicAssetUrl(lectureData.video_url);
      setStandaloneVideoUrl(hasStandaloneVideo ? lectureData.video_url : null);

      const { data: courseData } = await supabase
        .from('courses')
        .select('course_number, title, instructor_name')
        .eq('id', courseId)
        .maybeSingle();
      if (courseData) {
        setCourse(courseData);
      }

      const { data: artifactsData } = await supabase
        .from('lecture_artifacts')
        .select('*')
        .eq('lecture_id', lectureId)
        .order('created_at', { ascending: false });

      if (artifactsData) {
        const artifactChecks = await Promise.all(
          artifactsData.map(async (artifact) => ({
            artifact,
            valid: await probePublicAssetUrl(artifact.file_url),
          })),
        );

        const validArtifacts = artifactChecks
          .filter((entry) => entry.valid)
          .map((entry) => entry.artifact);
        const invalidArtifacts = artifactChecks
          .filter((entry) => !entry.valid)
          .map((entry) => entry.artifact.artifact_type);

        setArtifacts(validArtifacts);

        if (invalidArtifacts.length > 0) {
          setAssetNotice(
            `Some lecture assets are unavailable right now and were hidden: ${invalidArtifacts.join(', ')}.`,
          );
        }

        if (validArtifacts.some((a) => a.artifact_type === 'video_avatar_mp4' || a.artifact_type === 'video_static_mp4' || a.artifact_type === 'video_avatar') || hasStandaloneVideo) {
          setActiveTab('video');
        } else if (validArtifacts.some((a) => a.artifact_type === 'audio_mp3' || a.artifact_type === 'audio')) {
          setActiveTab('audio');
        } else if (validArtifacts.some((a) => a.artifact_type === 'pptx' || a.artifact_type === 'ppt')) {
          setActiveTab('presentation');
        }
      }

      if (isEducatorPreview) {
        return;
      }

      const { data: viewData } = await supabase
        .from('student_lecture_views')
        .select('id, completed, duration_watched')
        .eq('student_id', user.id)
        .eq('lecture_id', lectureId)
        .maybeSingle();

      if (viewData) {
        setViewId(viewData.id);
        setViewCompleted(Boolean(viewData.completed));
        currentTimeRef.current = viewData.duration_watched || 0;
        lastSyncedSecondsRef.current = viewData.duration_watched || 0;
      } else {
        const { data: insertedView, error: insertError } = await supabase
          .from('student_lecture_views')
          .insert({
            student_id: user.id,
            lecture_id: lectureId,
            duration_watched: 0,
            completed: false,
          })
          .select('id, completed, duration_watched')
          .single();

        if (insertError) {
          throw insertError;
        }

        setViewId(insertedView.id);
        setViewCompleted(Boolean(insertedView.completed));
      }
    } catch (loadError) {
      console.error('Error loading embedded lecture:', loadError);
      setError(loadError instanceof Error ? loadError.message : 'Unable to load the lecture right now.');
    } finally {
      setLoading(false);
    }
  };

  const persistLectureView = async (patch: { duration_watched?: number; completed?: boolean }) => {
    if (previewMode) return;
    if (!profile?.id) return;
    const payload = {
      ...(patch.duration_watched !== undefined ? { duration_watched: Math.max(0, Math.floor(patch.duration_watched)) } : {}),
      ...(patch.completed !== undefined ? { completed: patch.completed } : {}),
      last_viewed_at: new Date().toISOString(),
    };

    let data: { id: string; completed: boolean; duration_watched: number } | null = null;
    let persistError: Error | null = null;

    if (viewId) {
      const response = await supabase
        .from('student_lecture_views')
        .update(payload)
        .eq('id', viewId)
        .select('id, completed, duration_watched')
        .single();
      data = response.data;
      persistError = response.error;
    } else {
      const response = await supabase
        .from('student_lecture_views')
        .insert({
          student_id: profile.id,
          lecture_id: lectureId,
          duration_watched: payload.duration_watched ?? 0,
          completed: payload.completed ?? false,
          last_viewed_at: payload.last_viewed_at,
        })
        .select('id, completed, duration_watched')
        .single();
      data = response.data;
      persistError = response.error;
    }

    if (persistError) {
      console.error('Error updating lecture progress:', persistError);
      return;
    }

    if (data) {
      setViewId(data.id);
      setViewCompleted(Boolean(data.completed));
      currentTimeRef.current = data.duration_watched || currentTimeRef.current;
      lastSyncedSecondsRef.current = data.duration_watched || lastSyncedSecondsRef.current;
    }
  };

  const handleMediaPlay = () => {
    if (previewMode) return;
    onProgressChange?.({
      opened: true,
      completed: viewCompleted,
    });
  };

  const handleMediaTimeUpdate = (event: React.SyntheticEvent<HTMLVideoElement | HTMLAudioElement>) => {
    const media = event.currentTarget;
    currentTimeRef.current = media.currentTime;
    if (Math.floor(media.currentTime) - lastSyncedSecondsRef.current < 10) {
      return;
    }
    lastSyncedSecondsRef.current = Math.floor(media.currentTime);
    void persistLectureView({ duration_watched: media.currentTime });
  };

  const handleMediaEnded = () => {
    setViewCompleted(true);
    if (!previewMode) {
      void persistLectureView({
        duration_watched: currentTimeRef.current,
        completed: true,
      });
    }
  };

  if (loading) {
    return (
      <div className="min-h-[320px] grid place-items-center rounded-2xl border border-gray-200 bg-white">
        <Loader2 className="h-8 w-8 animate-spin text-brand-maroon" />
      </div>
    );
  }

  if (error || !lecture || !course) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-sm text-gray-600">
        {error || 'Lecture not found.'}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white">
      <div className="border-b border-gray-200 p-6">
        <div className="flex flex-wrap items-center gap-3">
          {(videoArtifact || standaloneVideoUrl) && (
            <button
              type="button"
              onClick={() => setActiveTab('video')}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 transition-colors ${
                activeTab === 'video'
                  ? 'bg-brand-maroon text-white'
                  : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
              }`}
            >
              <Video className="h-4 w-4" />
              Video
            </button>
          )}
          {audioArtifact && (
            <button
              type="button"
              onClick={() => setActiveTab('audio')}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 transition-colors ${
                activeTab === 'audio'
                  ? 'bg-brand-maroon text-white'
                  : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
              }`}
            >
              <Music className="h-4 w-4" />
              Audio
            </button>
          )}
          {slidesArtifact && (
            <button
              type="button"
              onClick={() => setActiveTab('presentation')}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 transition-colors ${
                activeTab === 'presentation'
                  ? 'bg-brand-maroon text-white'
                  : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
              }`}
            >
              <Presentation className="h-4 w-4" />
              Slides
            </button>
          )}
          {viewCompleted && (
            <span className="ml-auto inline-flex items-center gap-2 rounded-full bg-green-50 px-3 py-1 text-sm font-medium text-green-700">
              <Clock className="h-4 w-4" />
              Lecture completed
            </span>
          )}
        </div>
      </div>

      <div className="space-y-6 p-6">
        {assetNotice && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {assetNotice}
          </div>
        )}

        {activeTab === 'video' && (
          <div className="overflow-hidden rounded-xl bg-black">
            {(videoArtifact || standaloneVideoUrl) ? (
              <video
                controls
                className="aspect-video w-full"
                src={videoArtifact?.file_url || standaloneVideoUrl || undefined}
                onPlay={handleMediaPlay}
                onTimeUpdate={handleMediaTimeUpdate}
                onEnded={handleMediaEnded}
              >
                Your browser does not support the video tag.
              </video>
            ) : (
              <div className="aspect-video grid place-items-center text-sm text-white/80">
                No video available for this lecture.
              </div>
            )}
          </div>
        )}

        {activeTab === 'audio' && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-8">
            {audioArtifact ? (
              <div className="space-y-6">
                <div className="flex justify-center">
                  <div className="flex h-24 w-24 items-center justify-center rounded-full bg-brand-maroon/10">
                    <Music className="h-12 w-12 text-brand-maroon" />
                  </div>
                </div>
                <audio
                  controls
                  className="w-full"
                  src={audioArtifact.file_url}
                  onPlay={handleMediaPlay}
                  onTimeUpdate={handleMediaTimeUpdate}
                  onEnded={handleMediaEnded}
                >
                  Your browser does not support the audio tag.
                </audio>
                <div className="text-center">
                  <a
                    href={audioArtifact.file_url}
                    download
                    className="inline-flex items-center gap-2 text-brand-maroon hover:text-brand-maroon-hover"
                  >
                    <Download className="h-4 w-4" />
                    Download Audio
                  </a>
                </div>
              </div>
            ) : (
              <div className="text-sm text-gray-500">No audio available for this lecture.</div>
            )}
          </div>
        )}

        {activeTab === 'presentation' && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-8">
            {slidesArtifact ? (
              <div className="space-y-4 text-center">
                <div className="flex justify-center">
                  <div className="flex h-24 w-24 items-center justify-center rounded-full bg-brand-maroon/10">
                    <Presentation className="h-12 w-12 text-brand-maroon" />
                  </div>
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900">Presentation Slides</h3>
                  <p className="mt-2 text-gray-600">
                    Download the presentation to review the lecture slides from inside this studio.
                  </p>
                </div>
                <a
                  href={slidesArtifact.file_url}
                  download
                  className="inline-flex items-center gap-2 rounded-lg bg-brand-maroon px-6 py-3 text-white hover:bg-brand-maroon-hover"
                >
                  <Download className="h-5 w-5" />
                  Download Presentation
                </a>
              </div>
            ) : (
              <div className="text-sm text-gray-500">No presentation is attached to this lecture.</div>
            )}
          </div>
        )}

        <div className="rounded-xl border border-gray-200 p-6">
          <div className="mb-4 flex flex-wrap items-center gap-4 border-b border-gray-200 pb-4">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Clock className="h-4 w-4" />
              <span>{lecture.video_length} min</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <User className="h-4 w-4" />
              <span>{course.instructor_name}</span>
            </div>
          </div>
          <h3 className="mb-2 font-bold text-gray-900">About this lecture</h3>
          <p className="text-gray-600">{lecture.description || 'No description available.'}</p>
        </div>

        {lecture.script_text && (
          <div className="rounded-xl border border-gray-200 p-6">
            <h3 className="mb-4 flex items-center gap-2 font-bold text-gray-900">
              <FileText className="h-5 w-5" />
              Lecture Script
            </h3>
            <p className="whitespace-pre-wrap text-gray-600">{lecture.script_text}</p>
          </div>
        )}
      </div>
    </div>
  );
}
