'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getBackendBase } from '@/lib/backend';
import { Profile, supabase } from '@/lib/supabase';
import { AlertTriangle, CheckCircle2, Clock, FileCheck, Loader2, Monitor } from 'lucide-react';

const backendBase = getBackendBase();
const FULLSCREEN_TOLERANCE_PX = 8;

interface OnlineQuizQuestion {
  question_index: number;
  question: string;
  options: Record<string, string>;
  selected_option?: string | null;
  final_points_awarded?: number;
  final_feedback?: string | null;
  correct_option?: string | null;
}

interface OnlineQuizDetail {
  quiz_batch_id: string;
  course_id: string;
  quiz_name: string;
  course_number: string | null;
  course_title: string | null;
  instructor_name: string | null;
  available_at: string | null;
  due_at: string | null;
  time_limit_minutes: number;
  status: 'upcoming' | 'available' | 'in_progress' | 'submitted' | 'grades_released' | 'closed';
  question_count: number;
  total_marks: number;
  grades_published_at: string | null;
  policy_notice: string | null;
  attempt: {
    id: string;
    status: string;
    started_at: string;
    submitted_at: string | null;
    expires_at: string;
    integrity?: {
      refresh_count: number;
      integrity_warning_count: number;
      integrity_violation_count: number;
      fullscreen_exit_warning_count: number;
      policy_auto_submit_reason: string | null;
      policy_notice: string | null;
      last_policy_event_at: string | null;
    } | null;
    final_score?: number;
    overall_feedback?: string | null;
  } | null;
  questions: OnlineQuizQuestion[];
}

interface EducatorQuizReviewQuestion {
  question_index: number;
  question: string;
  options: Record<string, string>;
  ai_correct_option?: string | null;
  final_points_awarded?: number;
  final_feedback?: string | null;
}

interface EducatorQuizReviewAttempt {
  questions: EducatorQuizReviewQuestion[];
}

interface EducatorQuizReviewPayload {
  quiz_batch_id: string;
  quiz_name: string;
  status: string;
  course_id: string | null;
  course_number: string | null;
  course_title: string | null;
  instructor_name: string | null;
  available_at: string | null;
  due_at: string | null;
  time_limit_minutes: number;
  grades_published_at: string | null;
  attempts: EducatorQuizReviewAttempt[];
}

const getFullscreenElement = (): Element | null => {
  if (typeof document === 'undefined') return null;
  const fullscreenDocument = document as Document & {
    webkitFullscreenElement?: Element | null;
    mozFullScreenElement?: Element | null;
    msFullscreenElement?: Element | null;
  };

  return (
    fullscreenDocument.fullscreenElement
      || fullscreenDocument.webkitFullscreenElement
      || fullscreenDocument.mozFullScreenElement
      || fullscreenDocument.msFullscreenElement
      || null
  );
};

const hasFullscreenElement = () => Boolean(getFullscreenElement());

// Browsers do not expose document.fullscreenElement when the user enters
// browser-window fullscreen (for example, F11). Treat that state as fullscreen
// too so a valid fullscreen session is not blocked by the quiz guard.
const isEffectivelyFullscreen = () => {
  if (hasFullscreenElement()) return true;
  if (typeof window === 'undefined') return false;

  const screenWidth = window.screen?.width || 0;
  const screenHeight = window.screen?.height || 0;
  const availableWidth = window.screen?.availWidth || screenWidth;
  const availableHeight = window.screen?.availHeight || screenHeight;
  const widthMatches =
    Math.abs(window.innerWidth - screenWidth) <= FULLSCREEN_TOLERANCE_PX
    || Math.abs(window.innerWidth - availableWidth) <= FULLSCREEN_TOLERANCE_PX;
  const heightMatches =
    Math.abs(window.innerHeight - screenHeight) <= FULLSCREEN_TOLERANCE_PX
    || Math.abs(window.innerHeight - availableHeight) <= FULLSCREEN_TOLERANCE_PX;

  return widthMatches && heightMatches;
};

const requestElementFullscreen = async (target: HTMLElement) => {
  const fullscreenTarget = target as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
    mozRequestFullScreen?: () => Promise<void> | void;
    msRequestFullscreen?: () => Promise<void> | void;
  };
  const request =
    fullscreenTarget.requestFullscreen
      || fullscreenTarget.webkitRequestFullscreen
      || fullscreenTarget.mozRequestFullScreen
      || fullscreenTarget.msRequestFullscreen;

  if (!request) {
    throw new Error('This browser does not support fullscreen mode.');
  }

  await request.call(fullscreenTarget);
};

const exitBrowserFullscreen = async () => {
  if (typeof document === 'undefined' || !hasFullscreenElement()) return;
  const fullscreenDocument = document as Document & {
    webkitExitFullscreen?: () => Promise<void> | void;
    mozCancelFullScreen?: () => Promise<void> | void;
    msExitFullscreen?: () => Promise<void> | void;
  };
  const exit =
    fullscreenDocument.exitFullscreen
      || fullscreenDocument.webkitExitFullscreen
      || fullscreenDocument.mozCancelFullScreen
      || fullscreenDocument.msExitFullscreen;

  if (exit) {
    await exit.call(fullscreenDocument);
  }
};

type EmbeddedOnlineQuizProps = {
  courseId: string;
  quizBatchId: string;
  previewMode?: boolean;
  onProgressChange?: (state: { opened: boolean; completed: boolean }) => void;
  onQuizSubmitted?: (detail: OnlineQuizDetail) => void;
};

const normalizeQuizLoadError = (error: unknown) => {
  const fallback = 'Unable to load the quiz right now.';
  const rawMessage = error instanceof Error ? error.message : String(error || '');
  if (!rawMessage) return fallback;

  try {
    const parsed = JSON.parse(rawMessage);
    const parsedMessage = parsed.detail || parsed.message || parsed.error || rawMessage;
    if (String(parsedMessage).includes('not an online quiz')) {
      return 'This attached quiz is not an online quiz. Remove it, then attach or create an online quiz for Socratic Writing.';
    }
    return parsedMessage;
  } catch {
    if (rawMessage.includes('not an online quiz')) {
      return 'This attached quiz is not an online quiz. Remove it, then attach or create an online quiz for Socratic Writing.';
    }
    return rawMessage;
  }
};

const readResponseError = async (response: Response) => {
  const rawText = await response.text();
  if (!rawText) return response.statusText || 'Request failed.';

  try {
    const parsed = JSON.parse(rawText);
    const message = parsed.detail || parsed.message || parsed.error || rawText;
    return typeof message === 'string' ? message : JSON.stringify(message);
  } catch {
    return rawText;
  }
};

export default function EmbeddedOnlineQuiz({
  courseId,
  quizBatchId,
  previewMode = false,
  onProgressChange,
  onQuizSubmitted,
}: EmbeddedOnlineQuizProps) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [detail, setDetail] = useState<OnlineQuizDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [savingQuestionIndex, setSavingQuestionIndex] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [policyMessage, setPolicyMessage] = useState<string | null>(null);
  const [integrityError, setIntegrityError] = useState<string | null>(null);
  const [isFullscreenReady, setIsFullscreenReady] = useState(false);
  const [needsFullscreenResume, setNeedsFullscreenResume] = useState(false);
  const [policyDismissed, setPolicyDismissed] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const pendingIntegrityEventRef = useRef<string | null>(null);
  const reloadHandledForAttemptRef = useRef<string | null>(null);
  const attemptStartedOnThisPageRef = useRef<string | null>(null);
  const ignoreIntegrityUntilRef = useRef<number>(0);
  const completionNotifiedRef = useRef<string | null>(null);
  const fullscreenConfirmedRef = useRef(false);

  const isQuizInProgress = detail?.status === 'in_progress' && !!detail?.attempt;
  const shouldIgnoreIntegrityEvent = () => Date.now() < ignoreIntegrityUntilRef.current;

  useEffect(() => {
    void loadPage();
  }, [quizBatchId]);

  useEffect(() => {
    if (!detail?.attempt?.expires_at || detail.status !== 'in_progress') {
      setRemainingSeconds(null);
      return;
    }

    const updateRemaining = () => {
      const expiresAt = new Date(detail.attempt!.expires_at).getTime();
      const nextSeconds = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setRemainingSeconds(nextSeconds);
      if (nextSeconds === 0) {
        void submitQuiz(true);
      }
    };

    updateRemaining();
    const intervalId = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(intervalId);
  }, [detail?.attempt?.expires_at, detail?.status]);

  useEffect(() => {
    let resumeCheckTimer: number | null = null;

    const syncFullscreenState = () => {
      const active = isEffectivelyFullscreen();
      setIsFullscreenReady(active);
      if (active) {
        if (resumeCheckTimer !== null) {
          window.clearTimeout(resumeCheckTimer);
          resumeCheckTimer = null;
        }
        fullscreenConfirmedRef.current = true;
        setNeedsFullscreenResume(false);
        return;
      }

      const gracePeriodRemaining = ignoreIntegrityUntilRef.current - Date.now();
      if (gracePeriodRemaining > 0) {
        if (resumeCheckTimer !== null) window.clearTimeout(resumeCheckTimer);
        resumeCheckTimer = window.setTimeout(syncFullscreenState, gracePeriodRemaining + 50);
        return;
      }

      if (isQuizInProgress) {
        setNeedsFullscreenResume(true);
      }
    };

    syncFullscreenState();
    document.addEventListener('fullscreenchange', syncFullscreenState);
    window.addEventListener('resize', syncFullscreenState);
    return () => {
      if (resumeCheckTimer !== null) window.clearTimeout(resumeCheckTimer);
      document.removeEventListener('fullscreenchange', syncFullscreenState);
      window.removeEventListener('resize', syncFullscreenState);
    };
  }, [isQuizInProgress]);

  useEffect(() => {
    if (isQuizInProgress) return;
    fullscreenConfirmedRef.current = false;
    setNeedsFullscreenResume(false);
  }, [isQuizInProgress]);

  useEffect(() => {
    if (!detail) return;
    if (previewMode) return;
    const complete =
      detail.status === 'submitted'
      || detail.status === 'grades_released'
      || ['submitted', 'graded', 'timed_out'].includes(detail.attempt?.status || '');
    onProgressChange?.({
      opened: Boolean(detail.attempt),
      completed: Boolean(detail.attempt),
    });
    if (complete && detail.attempt?.id && completionNotifiedRef.current !== detail.attempt.id) {
      completionNotifiedRef.current = detail.attempt.id;
      onQuizSubmitted?.(detail);
    }
  }, [detail?.attempt?.id, detail?.attempt?.status, detail?.status, onProgressChange, onQuizSubmitted, previewMode]);

  useEffect(() => {
    if (!isQuizInProgress || !profile) return;

    const handleVisibilityChange = () => {
      if (shouldIgnoreIntegrityEvent()) return;
      if (document.visibilityState === 'hidden') {
        pendingIntegrityEventRef.current = 'tab_switch';
      }
    };

    const handleWindowBlur = () => {
      if (shouldIgnoreIntegrityEvent()) return;
      if (isEffectivelyFullscreen()) return;
      pendingIntegrityEventRef.current = 'window_blur';
    };

    const handleWindowFocus = () => {
      if (pendingIntegrityEventRef.current === 'window_blur' && isEffectivelyFullscreen()) {
        pendingIntegrityEventRef.current = null;
        return;
      }
      void handlePendingIntegrityEvent();
    };

    const handleFullscreenChange = () => {
      if (shouldIgnoreIntegrityEvent()) {
        const fullscreenActive = isEffectivelyFullscreen();
        setIsFullscreenReady(fullscreenActive);
        if (fullscreenActive) {
          fullscreenConfirmedRef.current = true;
          setNeedsFullscreenResume(false);
        }
        return;
      }

      const fullscreenActive = isEffectivelyFullscreen();
      if (fullscreenActive) {
        fullscreenConfirmedRef.current = true;
        setIsFullscreenReady(true);
        setNeedsFullscreenResume(false);
        return;
      }

      setIsFullscreenReady(false);
      if (!isQuizInProgress || submitting) return;

      if (document.visibilityState === 'visible' && document.hasFocus()) {
        pendingIntegrityEventRef.current = 'fullscreen_exit';
        setNeedsFullscreenResume(true);
        void handlePendingIntegrityEvent();
      } else {
        pendingIntegrityEventRef.current = 'tab_switch';
        setNeedsFullscreenResume(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [isQuizInProgress, profile?.id, submitting]);

  useEffect(() => {
    if (!isQuizInProgress || !profile || !detail?.attempt?.id) return;

    // A navigation entry remains "reload" for the lifetime of the document.
    // Do not mistake an attempt started after that reload for an active quiz
    // that was refreshed.
    if (attemptStartedOnThisPageRef.current === detail.attempt.id) {
      reloadHandledForAttemptRef.current = detail.attempt.id;
      return;
    }

    const navigationEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    const isReload = navigationEntries.some((entry) => entry.type === 'reload');
    if (!isReload || reloadHandledForAttemptRef.current === detail.attempt.id) {
      return;
    }

    reloadHandledForAttemptRef.current = detail.attempt.id;
    setNeedsFullscreenResume(!isEffectivelyFullscreen());
    void registerRefreshAttempt();
  }, [isQuizInProgress, profile?.id, detail?.attempt?.id]);

  const formattedRemaining = useMemo(() => {
    if (remainingSeconds === null) return null;
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }, [remainingSeconds]);

  const enterFullscreen = async () => {
    if (typeof document === 'undefined') return false;
    if (isEffectivelyFullscreen()) {
      ignoreIntegrityUntilRef.current = Date.now() + 5000;
      fullscreenConfirmedRef.current = true;
      setIsFullscreenReady(true);
      setNeedsFullscreenResume(false);
      setIntegrityError(null);
      pendingIntegrityEventRef.current = null;
      return true;
    }

    ignoreIntegrityUntilRef.current = Date.now() + 5000;

    try {
      await requestElementFullscreen(containerRef.current || document.documentElement);
      await new Promise((resolve) => window.setTimeout(resolve, 100));
      if (!isEffectivelyFullscreen()) {
        throw new Error('Fullscreen did not activate. Please allow fullscreen for this site and try again.');
      }
      fullscreenConfirmedRef.current = true;
      setIsFullscreenReady(true);
      setNeedsFullscreenResume(false);
      setIntegrityError(null);
      pendingIntegrityEventRef.current = null;
      return true;
    } catch (error) {
      console.error('Failed to enter fullscreen:', error);
      setIntegrityError('Fullscreen is required to continue this quiz.');
      return false;
    }
  };

  const loadPage = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setIntegrityError('Please sign in again to continue.');
        return;
      }

      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (!profileData) {
        setIntegrityError('Unable to confirm your profile for this quiz.');
        return;
      }

      if (profileData.role === 'educator' && previewMode) {
        setProfile(profileData);
        await fetchEducatorPreview(profileData.id);
        return;
      }

      if (profileData.role !== 'student') {
        setIntegrityError('Student access is required to view this quiz.');
        return;
      }

      setProfile(profileData);
      await fetchDetail(user.id);
    } catch (error) {
      console.error('Error loading online quiz:', error);
      setIntegrityError(normalizeQuizLoadError(error));
    } finally {
      setLoading(false);
    }
  };

  const fetchEducatorPreview = async (educatorId: string) => {
    if (!backendBase) {
      setIntegrityError('Backend is not configured for quiz preview.');
      return;
    }

    const response = await fetch(`${backendBase}/api/educator/quiz/online/${quizBatchId}?educatorId=${educatorId}`);
    if (!response.ok) {
      throw new Error(await readResponseError(response));
    }

    const payload = (await response.json()) as EducatorQuizReviewPayload;
    const previewAttempt = (payload.attempts || []).find((attempt) => attempt.questions?.length);

    if (!previewAttempt?.questions?.length) {
      setIntegrityError('This quiz exists, but no generated question set is available to preview yet.');
      return;
    }

    const questions = previewAttempt.questions.map((question) => ({
      question_index: question.question_index,
      question: question.question,
      options: question.options || {},
      selected_option: null,
      correct_option: question.ai_correct_option || null,
      final_points_awarded: question.final_points_awarded,
      final_feedback: question.final_feedback,
    }));

    setDetail({
      quiz_batch_id: payload.quiz_batch_id,
      course_id: payload.course_id || courseId,
      quiz_name: payload.quiz_name || 'Online Quiz',
      course_number: payload.course_number,
      course_title: payload.course_title,
      instructor_name: payload.instructor_name,
      available_at: payload.available_at,
      due_at: payload.due_at,
      time_limit_minutes: payload.time_limit_minutes || 30,
      status: 'available',
      question_count: questions.length,
      total_marks: questions.length,
      grades_published_at: payload.grades_published_at,
      policy_notice: 'Educator preview is read-only. Real students still use the fullscreen, refresh, and integrity-controlled quiz attempt flow.',
      attempt: null,
      questions,
    });
  };

  const fetchDetail = async (studentId: string) => {
    if (!backendBase) {
      setIntegrityError('Backend is not configured for quiz loading.');
      return;
    }
    const response = await fetch(`${backendBase}/api/student/quiz/online/${quizBatchId}?studentId=${studentId}`);
    if (!response.ok) {
      throw new Error(await readResponseError(response));
    }

    const payload = (await response.json()) as OnlineQuizDetail;
    setDetail(payload);
    setPolicyMessage(payload.policy_notice || payload.attempt?.integrity?.policy_notice || null);
  };

  const registerRefreshAttempt = async () => {
    if (!profile || !backendBase) return;
    try {
      const response = await fetch(`${backendBase}/api/student/quiz/online/register-refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quizBatchId,
          studentId: profile.id,
        }),
      });

      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }

      const payload = await response.json();
      setDetail(payload.detail as OnlineQuizDetail);
      if (payload.message) {
        setPolicyMessage(payload.message);
      }
    } catch (error) {
      console.error('Error registering quiz refresh:', error);
      setIntegrityError('Unable to validate the refresh policy right now.');
    }
  };

  const handlePendingIntegrityEvent = async () => {
    const eventType = pendingIntegrityEventRef.current;
    if (!eventType || !profile || !backendBase || !isQuizInProgress) return;

    pendingIntegrityEventRef.current = null;

    try {
      const response = await fetch(`${backendBase}/api/student/quiz/online/report-integrity-event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quizBatchId,
          studentId: profile.id,
          eventType,
        }),
      });

      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }

      const payload = await response.json();
      setDetail(payload.detail as OnlineQuizDetail);
      setNeedsFullscreenResume(Boolean(payload.require_fullscreen) && !isEffectivelyFullscreen());

      if (payload.message) {
        setPolicyMessage(payload.message);
        setPolicyDismissed(false);
      }
    } catch (error) {
      console.error('Error reporting integrity event:', error);
      setIntegrityError('Unable to validate quiz policy state right now.');
    }
  };

  const startQuiz = async () => {
    if (!profile || !backendBase) return;

    const fullscreenEntered = await enterFullscreen();
    if (!fullscreenEntered || !isEffectivelyFullscreen()) {
      window.alert('You must enter fullscreen mode before starting the quiz.');
      return;
    }

    // Keep fullscreen transition events from being interpreted as exits while
    // the start request changes the quiz from available to in_progress.
    ignoreIntegrityUntilRef.current = Date.now() + 5000;
    fullscreenConfirmedRef.current = true;
    pendingIntegrityEventRef.current = null;
    setNeedsFullscreenResume(false);
    setStarting(true);
    try {
      const response = await fetch(`${backendBase}/api/student/quiz/online/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quizBatchId,
          studentId: profile.id,
        }),
      });

      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }

      const payload = (await response.json()) as OnlineQuizDetail;
      ignoreIntegrityUntilRef.current = Date.now() + 5000;
      attemptStartedOnThisPageRef.current = payload.attempt?.id || null;
      fullscreenConfirmedRef.current = true;
      pendingIntegrityEventRef.current = null;
      setDetail(payload);
      setNeedsFullscreenResume(false);
      setIsFullscreenReady(isEffectivelyFullscreen());
      setPolicyMessage(payload.policy_notice || payload.attempt?.integrity?.policy_notice || null);
      setPolicyDismissed(false);
    } catch (error) {
      console.error('Error starting online quiz:', error);
      const message = error instanceof Error ? error.message : 'Failed to start the quiz.';
      setIntegrityError(message);
      window.alert(message);
    } finally {
      setStarting(false);
    }
  };

  const saveAnswer = async (questionIndex: number, selectedOption: string) => {
    if (!detail || !profile || !backendBase) return;
    if (isQuizInProgress && !isEffectivelyFullscreen()) {
      setNeedsFullscreenResume(true);
      setIntegrityError('Return to fullscreen before answering this quiz.');
      return;
    }

    setDetail((current) => {
      if (!current) return current;
      return {
        ...current,
        questions: current.questions.map((question) =>
          question.question_index === questionIndex
            ? { ...question, selected_option: selectedOption }
            : question,
        ),
      };
    });

    setSavingQuestionIndex(questionIndex);
    try {
      const response = await fetch(`${backendBase}/api/student/quiz/online/save-answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quizBatchId,
          studentId: profile.id,
          questionIndex,
          selectedOption,
        }),
      });

      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }
    } catch (error) {
      console.error('Error saving answer:', error);
      const message = error instanceof Error ? error.message : 'Unknown save error.';
      setIntegrityError(`Answer could not be saved: ${message}`);
      window.alert(`Failed to save the answer: ${message}`);
    } finally {
      setSavingQuestionIndex(null);
    }
  };

  const submitQuiz = async (silent = false) => {
    if (!profile || !backendBase || submitting) return;
    if (!silent && isQuizInProgress && !isEffectivelyFullscreen()) {
      setNeedsFullscreenResume(true);
      setIntegrityError('Return to fullscreen before submitting this quiz.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`${backendBase}/api/student/quiz/online/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quizBatchId,
          studentId: profile.id,
        }),
      });

      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }

      const payload = (await response.json()) as OnlineQuizDetail;
      completionNotifiedRef.current = payload.attempt?.id || completionNotifiedRef.current;
      try {
        await exitBrowserFullscreen();
      } catch (fullscreenExitError) {
        console.warn('Quiz submitted, but exiting fullscreen failed:', fullscreenExitError);
      }
      setDetail(payload);
      onQuizSubmitted?.(payload);
      setNeedsFullscreenResume(false);
      setIsFullscreenReady(false);
      setPolicyMessage(payload.policy_notice || payload.attempt?.integrity?.policy_notice || null);
      if (!silent) {
        window.alert('Quiz submitted successfully.');
      }
    } catch (error) {
      console.error('Error submitting quiz:', error);
      const message = error instanceof Error ? error.message : 'Failed to submit the quiz.';
      setIntegrityError(message);
      if (!silent) {
        window.alert(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[320px] grid place-items-center rounded-2xl border border-gray-200 bg-white">
        <Loader2 className="h-8 w-8 animate-spin text-brand-maroon" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-sm text-gray-600">
        {integrityError || 'Unable to load the quiz in Socratic right now.'}
      </div>
    );
  }

  const statusLabel = previewMode ? 'Educator preview' : detail.status.replace('_', ' ');

  return (
    <div
      ref={containerRef}
      className="relative max-h-[85vh] overflow-y-auto rounded-2xl border border-gray-200 bg-white [&:fullscreen]:h-screen [&:fullscreen]:max-h-screen [&:fullscreen]:rounded-none"
    >
      <div className="border-b border-gray-200 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-2xl font-bold text-gray-900">{detail.quiz_name}</h3>
            <p className="mt-2 text-gray-600">
              {detail.course_number} - {detail.course_title}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              Instructor: {detail.instructor_name}
            </p>
          </div>

          {detail.status === 'in_progress' && formattedRemaining && (
            <div className="flex items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-orange-800">
              <Clock className="h-4 w-4" />
              Time Remaining: {formattedRemaining}
            </div>
          )}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-xl bg-gray-50 p-4">
            <div className="mb-1 text-sm text-gray-500">Questions</div>
            <div className="text-2xl font-semibold text-gray-900">{detail.question_count}</div>
          </div>
          <div className="rounded-xl bg-gray-50 p-4">
            <div className="mb-1 text-sm text-gray-500">Marks</div>
            <div className="text-2xl font-semibold text-gray-900">{detail.total_marks}</div>
          </div>
          <div className="rounded-xl bg-gray-50 p-4">
            <div className="mb-1 text-sm text-gray-500">Time Limit</div>
            <div className="text-2xl font-semibold text-gray-900">{detail.time_limit_minutes} min</div>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-gray-200 p-5">
          <div className="space-y-2 text-sm text-gray-700">
            <p>
              Status: <span className="font-medium capitalize text-gray-900">{statusLabel}</span>
            </p>
            {detail.available_at && <p>Available From: {new Date(detail.available_at).toLocaleString()}</p>}
            {detail.due_at && <p>Due Date: {new Date(detail.due_at).toLocaleString()}</p>}
            {detail.attempt?.integrity && (
              <>
                <p>
                  Refreshes Used: <span className="font-medium text-gray-900">{detail.attempt.integrity.refresh_count}/3</span>
                </p>
                <p>
                  Policy Warnings: <span className="font-medium text-gray-900">{detail.attempt.integrity.integrity_warning_count}</span>
                </p>
                <p>
                  Policy Violations: <span className="font-medium text-gray-900">{detail.attempt.integrity.integrity_violation_count}</span>
                </p>
                <p>
                  Esc Warnings: <span className="font-medium text-gray-900">{detail.attempt.integrity.fullscreen_exit_warning_count}</span>
                </p>
              </>
            )}
          </div>

          {policyMessage && !policyDismissed && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4" />
                  <span>{policyMessage}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setPolicyDismissed(true)}
                  className="text-sm font-medium text-red-800 hover:text-red-900"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {integrityError && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
              {integrityError}
            </div>
          )}

          {detail.status === 'upcoming' && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
              This quiz is scheduled but not available yet.
            </div>
          )}

          {previewMode && (
            <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-blue-800">
              {detail.policy_notice}
            </div>
          )}

          {!previewMode && detail.status === 'available' && (
            <div className="mt-4">
              <p className="mb-4 text-gray-600">
                This quiz allows one attempt only. Enter fullscreen first, then start the quiz. After the quiz starts,
                the timer will continue even if you refresh the page.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void enterFullscreen()}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-6 py-3 font-medium text-gray-900 hover:bg-gray-50"
                >
                  <Monitor className="h-4 w-4" />
                  {isFullscreenReady ? 'Fullscreen Ready' : 'Enter Fullscreen'}
                </button>
                <button
                  type="button"
                  onClick={startQuiz}
                  disabled={starting || !isFullscreenReady}
                  className="rounded-lg bg-brand-maroon px-6 py-3 font-medium text-white hover:bg-brand-maroon-hover disabled:opacity-50"
                >
                  {starting ? 'Starting...' : 'Start Quiz'}
                </button>
              </div>
            </div>
          )}

          {detail.status === 'submitted' && (
            <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-blue-800">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                {detail.policy_notice || 'Submitted. Your score will appear here when grades are released.'}
              </div>
              {detail.attempt?.final_score !== undefined && detail.attempt?.final_score !== null && (
                <div className="mt-3 rounded-lg bg-white/80 px-3 py-2 text-sm text-blue-950">
                  Score: <span className="font-semibold">{detail.attempt.final_score} / {detail.total_marks}</span>
                </div>
              )}
            </div>
          )}

          {detail.status === 'closed' && (
            <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-gray-700">
              This quiz is closed.
            </div>
          )}
        </div>
      </div>

      {previewMode && (
        <div className="space-y-8 p-6">
          {detail.questions.map((question) => (
            <div key={question.question_index} className="border-b border-gray-200 pb-6 last:border-b-0 last:pb-0">
              <div className="mb-4 font-semibold text-gray-900">
                {question.question_index + 1}. {question.question}
              </div>
              <div className="space-y-3">
                {Object.entries(question.options || {}).map(([optionKey, optionValue]) => (
                  <label
                    key={optionKey}
                    className="flex items-start gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-700"
                  >
                    <input
                      type="radio"
                      name={`preview-question-${question.question_index}`}
                      disabled
                      className="mt-1"
                    />
                    <div>
                      <div className="font-medium text-gray-900">{optionKey}</div>
                      <div>{optionValue}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {detail.status === 'in_progress' && (
        <div className="relative space-y-8 p-6">
          {needsFullscreenResume && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-white/95 p-6 backdrop-blur-sm">
              <div className="max-w-lg space-y-4 rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm">
                  <Monitor className="h-6 w-6 text-red-600" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">Return to Fullscreen</h2>
                  <p className="mt-2 text-sm text-gray-700">
                    You must stay in fullscreen mode while this quiz is in progress. Re-enter fullscreen to continue.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void enterFullscreen()}
                  className="rounded-lg bg-brand-maroon px-5 py-2.5 font-medium text-white hover:bg-brand-maroon-hover"
                >
                  Re-enter Fullscreen
                </button>
              </div>
            </div>
          )}

          {detail.questions.map((question) => (
            <div key={question.question_index} className="border-b border-gray-200 pb-6 last:border-b-0 last:pb-0">
              <div className="mb-4 font-semibold text-gray-900">
                {question.question_index + 1}. {question.question}
              </div>
              <div className="space-y-3">
                {Object.entries(question.options || {}).map(([optionKey, optionValue]) => (
                  <label
                    key={optionKey}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-colors ${
                      question.selected_option === optionKey
                        ? 'border-brand-maroon bg-red-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name={`question-${question.question_index}`}
                      checked={question.selected_option === optionKey}
                      onChange={() => saveAnswer(question.question_index, optionKey)}
                      disabled={submitting || savingQuestionIndex !== null || needsFullscreenResume}
                      className="mt-1"
                    />
                    <div>
                      <div className="font-medium text-gray-900">{optionKey}</div>
                      <div className="text-gray-700">{optionValue}</div>
                    </div>
                  </label>
                ))}
              </div>
              {savingQuestionIndex === question.question_index && (
                <div className="mt-3 text-sm text-gray-500">Saving answer...</div>
              )}
            </div>
          ))}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => submitQuiz()}
              disabled={submitting}
              className="rounded-lg bg-brand-maroon px-6 py-3 font-medium text-white hover:bg-brand-maroon-hover disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Submit Quiz'}
            </button>
          </div>
        </div>
      )}

      {detail.status === 'grades_released' && (
        <div className="space-y-6 p-6">
          <div className="rounded-xl border border-green-200 bg-green-50 p-5">
            <div className="mb-2 flex items-center gap-2 font-medium text-green-800">
              <FileCheck className="h-5 w-5" />
              Grades Released
            </div>
            <div className="text-3xl font-bold text-gray-900">
              {detail.attempt?.final_score ?? 0} / {detail.total_marks}
            </div>
            {detail.attempt?.overall_feedback && (
              <p className="mt-3 text-gray-700">{detail.attempt.overall_feedback}</p>
            )}
          </div>

          {detail.questions.map((question) => (
            <div key={question.question_index} className="rounded-xl border border-gray-200 p-5">
              <div className="mb-3 font-semibold text-gray-900">
                {question.question_index + 1}. {question.question}
              </div>
              <div className="space-y-2 text-sm text-gray-700">
                <p>Your answer: <span className="font-medium text-gray-900">{question.selected_option || 'No answer'}</span></p>
                <p>AI graded answer: <span className="font-medium text-gray-900">{question.correct_option || 'N/A'}</span></p>
                <p>Score: <span className="font-medium text-gray-900">{question.final_points_awarded ?? 0}</span></p>
                {question.final_feedback && <p>Feedback: {question.final_feedback}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
