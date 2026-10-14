'use client';

import { ChangeEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock3,
  Eye,
  FileQuestion,
  FileText,
  GraduationCap,
  Info,
  Loader2,
  Lock,
  Send,
  ShieldAlert,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import EducatorLayout from '@/components/EducatorLayout';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import SocraticWizardMaterials, {
  SocraticWizardLinkedOption,
  SocraticWizardReadingOption,
} from '@/components/socratic-writing/SocraticWizardMaterials';
import SocraticWizardStageDesigner from '@/components/socratic-writing/SocraticWizardStageDesigner';
import { uploadFile } from '@/lib/fileUpload';
import { hasProfileRole } from '@/lib/profileRoles';
import {
  clearPendingSocraticCreatedResource,
  createDefaultStudioBlueprint,
  createPreviewStudioSession,
  loadPendingSocraticCreatedResource,
  saveSocraticPreviewPayload,
  SOCRATIC_STAGE_ORDER,
  SocraticResource,
  SocraticStageKey,
  SocraticStudioBlueprint,
} from '@/lib/socraticWriting';
import {
  generateSocraticReadinessQuestions,
  generateSocraticStarterResponse,
  saveSocraticAssignmentConfig,
} from '@/lib/socraticWritingApi';
import { sanitizeFileName } from '@/lib/assignments';
import { Course, Profile, supabase } from '@/lib/supabase';

const WIZARD_STEPS = [
  'Select Course',
  'Assignment Setup',
  'Stage Designer',
  'Compliance',
  'Review & Publish',
] as const;

type QuestionDocument = {
  name: string;
  url: string;
  storagePath: string;
  storageBucket: 'course-files' | 'assignment-files';
};

type SocraticWorkingSession = {
  id: string;
  educatorId: string;
  courseId: string;
  currentStep: number;
  assignmentTitle: string;
  description: string;
  availableAt: string;
  dueAt: string;
  lateUntil: string;
  pointsPossible: string;
  wordCount: string;
  questionDocument: QuestionDocument | null;
  blueprint: SocraticStudioBlueprint;
  updatedAt: string;
};

const WORKING_SESSION_KEY = 'socratic-writing:assignment-builder-working-session';
const LEGACY_DATABASE_DRAFT_PREFIX = 'socratic-writing:database-fallback-draft:';

const createSessionId = () => (
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
);

const loadWorkingSession = () => {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(WORKING_SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SocraticWorkingSession;
  } catch {
    window.sessionStorage.removeItem(WORKING_SESSION_KEY);
    return null;
  }
};

const saveWorkingSession = (session: SocraticWorkingSession) => {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(WORKING_SESSION_KEY, JSON.stringify(session));
};

const clearWorkingSession = () => {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(WORKING_SESSION_KEY);
};

const discardWorkingSession = async () => {
  const session = loadWorkingSession();
  clearWorkingSession();
  const document = session?.questionDocument;
  if (!document?.storagePath || document.storageBucket !== 'course-files') return;
  const { error } = await supabase.storage.from('course-files').remove([document.storagePath]);
  if (error) console.warn('Could not remove the abandoned temporary question PDF:', error);
};

const clearLegacyBrowserDrafts = () => {
  if (typeof window === 'undefined') return;
  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(LEGACY_DATABASE_DRAFT_PREFIX)) {
      window.localStorage.removeItem(key);
    }
  }
};

const toDateTimeLocalValue = (value: string | null | undefined) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const fromDateTimeLocalValue = (value: string) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const stripUploadTimestamp = (value: string) => value.replace(/^\d{10,}[-_]/, '').trim();

const fileNameFromUrl = (value: string | null | undefined) => {
  if (!value) return '';
  const last = value.split('?')[0].split('#')[0].split('/').filter(Boolean).pop() || '';
  try {
    return stripUploadTimestamp(decodeURIComponent(last));
  } catch {
    return stripUploadTimestamp(last);
  }
};

const makeSignature = (value: unknown) => JSON.stringify(value);

const classNames = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' ');

export default function SocraticAssignmentWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const questionInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [studentCounts, setStudentCounts] = useState<Record<string, number>>({});
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [step, setStep] = useState(1);
  const [assignmentTitle, setAssignmentTitle] = useState('');
  const [description, setDescription] = useState('');
  const [availableAt, setAvailableAt] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [lateUntil, setLateUntil] = useState('');
  const [pointsPossible, setPointsPossible] = useState('100');
  const [wordCount, setWordCount] = useState('1500');
  const [previewNumber, setPreviewNumber] = useState(1);
  const [questionFile, setQuestionFile] = useState<File | null>(null);
  const [questionDocument, setQuestionDocument] = useState<QuestionDocument | null>(null);
  const [blueprint, setBlueprint] = useState<SocraticStudioBlueprint | null>(null);
  const [workingSessionId, setWorkingSessionId] = useState('');
  const [sessionReady, setSessionReady] = useState(false);
  const [openingCourseSession, setOpeningCourseSession] = useState(false);
  const [availableReadings, setAvailableReadings] = useState<SocraticWizardReadingOption[]>([]);
  const [availableQuizzes, setAvailableQuizzes] = useState<SocraticWizardLinkedOption[]>([]);
  const [availableAvatarLectures, setAvailableAvatarLectures] = useState<SocraticWizardLinkedOption[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState('');
  const [showPublishConfirmation, setShowPublishConfirmation] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const selectedCourse = useMemo(
    () => courses.find((course) => course.id === selectedCourseId) || null,
    [courses, selectedCourseId],
  );
  const realStudentCount = selectedCourseId ? studentCounts[selectedCourseId] || 0 : 0;
  const assignmentLabel = selectedCourse
    ? `${selectedCourse.title} Assignment ${previewNumber}`
    : `Assignment ${previewNumber}`;

  const buildCurrentBlueprint = useCallback((source: SocraticStudioBlueprint) => ({
    ...source,
    assignmentId: source.assignmentId || `session-${workingSessionId || selectedCourseId}`,
    courseId: selectedCourseId || source.courseId,
    courseCode: selectedCourse?.course_number || source.courseCode,
    courseTitle: selectedCourse?.title || source.courseTitle,
    assignmentTitle: assignmentTitle.trim() || source.assignmentTitle,
    assignmentBrief: description.trim() || source.assignmentBrief,
    assignmentDocument: questionDocument
      ? { name: questionDocument.name, url: questionDocument.url }
      : undefined,
    dueAt: fromDateTimeLocalValue(dueAt) || source.dueAt,
    pointsPossible: Number(pointsPossible) || 0,
    wordCount: Math.max(1, Number(wordCount) || 1500),
    builderVersion: 'wizard_v2' as const,
    verificationMethod: 'online_quiz' as const,
    stages: {
      ...source.stages,
      write: { ...source.stages.write, enabled: true },
    },
  }), [assignmentTitle, description, dueAt, pointsPossible, questionDocument, selectedCourse, selectedCourseId, wordCount, workingSessionId]);

  const getReadinessSignature = useCallback((stage: SocraticStageKey, source = blueprint) => {
    if (!source) return '';
    const current = buildCurrentBlueprint(source);
    return makeSignature({
      title: current.assignmentTitle,
      brief: current.assignmentBrief,
      document: current.assignmentDocument,
      resources: current.resources.map(({ id, title, summary, required, type, url, resourceRefId }) => ({
        id, title, summary, required, type, url, resourceRefId,
      })),
      stage,
      guidance: current.stages[stage].readinessGuidance,
    });
  }, [blueprint, buildCurrentBlueprint]);

  const getStarterSignature = useCallback((stage: SocraticStageKey, source = blueprint) => {
    if (!source) return '';
    const current = buildCurrentBlueprint(source);
    return makeSignature({
      readiness: getReadinessSignature(stage, current),
      goals: current.stages[stage].readinessQuestions,
      guidance: current.stages[stage].starterGuidance,
    });
  }, [blueprint, buildCurrentBlueprint, getReadinessSignature]);

  useEffect(() => {
    void loadInitialContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadInitialContext = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/educator/login');
        return;
      }

      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      if (profileError) throw profileError;
      if (!hasProfileRole(profileData, 'educator')) {
        router.push('/student/dashboard');
        return;
      }
      setProfile(profileData as Profile);
      clearLegacyBrowserDrafts();

      const { data: courseRows, error: courseError } = await supabase
        .from('courses')
        .select('*')
        .eq('educator_id', user.id)
        .order('created_at', { ascending: false });
      if (courseError) throw courseError;
      const ownedCourses = (courseRows || []) as Course[];
      setCourses(ownedCourses);

      const ids = ownedCourses.map((course) => course.id);
      if (ids.length) {
        const { data: enrollmentRows, error: enrollmentError } = await supabase
          .from('course_students')
          .select('course_id,enrollment_type')
          .in('course_id', ids);
        if (enrollmentError) throw enrollmentError;
        setStudentCounts((enrollmentRows || []).reduce<Record<string, number>>((counts, row) => {
          if (row.enrollment_type !== 'educator_test') {
            counts[row.course_id] = (counts[row.course_id] || 0) + 1;
          }
          return counts;
        }, {}));
      }

      const presetCourseId = searchParams.get('courseId');
      if (presetCourseId && ownedCourses.some((course) => course.id === presetCourseId)) {
        setSelectedCourseId(presetCourseId);
        if (searchParams.get('resumeSession') === '1') {
          await openCourseSession(profileData as Profile, ownedCourses, presetCourseId, true);
        }
      }
      if (searchParams.get('resumeSession') !== '1') {
        await discardWorkingSession();
        clearPendingSocraticCreatedResource();
      }
    } catch (error) {
      console.error('Error loading Socratic assignment wizard:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to load assignment creator.');
    } finally {
      setLoading(false);
    }
  };

  const openCourseSession = async (
    educator: Profile,
    courseList: Course[],
    courseId: string,
    resume: boolean,
  ) => {
    const course = courseList.find((item) => item.id === courseId);
    if (!course) return;
    setSessionReady(false);
    const assignmentNumberResult = await supabase
      .from('assignments')
      .select('assignment_number')
      .eq('course_id', courseId)
      .order('assignment_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (assignmentNumberResult.error) throw assignmentNumberResult.error;
    setPreviewNumber((assignmentNumberResult.data?.assignment_number || 0) + 1);

    const existingSession = resume ? loadWorkingSession() : null;
    if (
      existingSession
      && existingSession.educatorId === educator.id
      && existingSession.courseId === courseId
    ) {
      const restoredBlueprint = {
        ...createDefaultStudioBlueprint({
          assignmentId: `session-${existingSession.id}`,
          courseId,
          courseCode: course.course_number,
          courseTitle: course.title,
          assignmentTitle: existingSession.assignmentTitle || 'Untitled Socratic Assignment',
          assignmentBrief: existingSession.description || '',
          dueAt: fromDateTimeLocalValue(existingSession.dueAt) || new Date().toISOString(),
          pointsPossible: Number(existingSession.pointsPossible) || 100,
          wordCount: Number(existingSession.wordCount) || 1500,
        }),
        ...(existingSession.blueprint || {}),
        builderVersion: 'wizard_v2' as const,
        verificationMethod: 'online_quiz' as const,
      };
      restoredBlueprint.stages = SOCRATIC_STAGE_ORDER.reduce((stages, stageKey) => {
        stages[stageKey] = {
          ...createDefaultStudioBlueprint({
            assignmentId: `session-${existingSession.id}`,
            courseId,
            courseCode: course.course_number,
            courseTitle: course.title,
            assignmentTitle: existingSession.assignmentTitle || 'Untitled Socratic Assignment',
            assignmentBrief: existingSession.description || '',
            dueAt: fromDateTimeLocalValue(existingSession.dueAt) || new Date().toISOString(),
            pointsPossible: Number(existingSession.pointsPossible) || 100,
            wordCount: Number(existingSession.wordCount) || 1500,
          }).stages[stageKey],
          ...(existingSession.blueprint?.stages?.[stageKey] || {}),
          enabled: stageKey === 'write' ? true : existingSession.blueprint?.stages?.[stageKey]?.enabled !== false,
        };
        return stages;
      }, { ...restoredBlueprint.stages });
      setWorkingSessionId(existingSession.id);
      setQuestionFile(null);
      setAssignmentTitle(existingSession.assignmentTitle);
      setDescription(existingSession.description);
      setAvailableAt(existingSession.availableAt);
      setDueAt(existingSession.dueAt);
      setLateUntil(existingSession.lateUntil);
      setPointsPossible(existingSession.pointsPossible);
      setWordCount(existingSession.wordCount);
      setQuestionDocument(existingSession.questionDocument
        ? { ...existingSession.questionDocument, storageBucket: existingSession.questionDocument.storageBucket || 'course-files' }
        : null);
      setBlueprint(restoredBlueprint);
      setStep(Math.max(2, Math.min(existingSession.currentStep, 5)));
    } else {
      const sessionId = createSessionId();
      setAssignmentTitle('');
      setDescription('');
      setAvailableAt('');
      setDueAt('');
      setLateUntil('');
      setPointsPossible('100');
      setWordCount('1500');
      setQuestionFile(null);
      setQuestionDocument(null);
      setGenerationError('');
      const initialBlueprint = createDefaultStudioBlueprint({
        assignmentId: `session-${sessionId}`,
        courseId,
        courseCode: course.course_number,
        courseTitle: course.title,
        assignmentTitle: 'Untitled Socratic Assignment',
        assignmentBrief: '',
        dueAt: new Date().toISOString(),
        pointsPossible: 100,
        wordCount: 1500,
      });
      initialBlueprint.builderVersion = 'wizard_v2';
      initialBlueprint.verificationMethod = 'online_quiz';
      setWorkingSessionId(sessionId);
      setBlueprint(initialBlueprint);
      setStep(2);
      saveWorkingSession({
        id: sessionId,
        educatorId: educator.id,
        courseId,
        currentStep: 2,
        assignmentTitle: '',
        description: '',
        availableAt: '',
        dueAt: '',
        lateUntil: '',
        pointsPossible: '100',
        wordCount: '1500',
        questionDocument: null,
        blueprint: initialBlueprint,
        updatedAt: new Date().toISOString(),
      });
    }
    setSessionReady(true);
    router.replace(`/educator/socratic-writing?courseId=${courseId}&resumeSession=1`);
    void loadResourceLibrary(courseId, course);
  };

  const loadResourceLibrary = async (courseId: string, course: Course) => {
    try {
      const readings: SocraticWizardReadingOption[] = [];
      const seen = new Set<string>();
      const addReading = (reading: SocraticWizardReadingOption) => {
        if (reading.id && !seen.has(reading.id)) {
          seen.add(reading.id);
          readings.push(reading);
        }
      };

      (course.course_materials_data || []).forEach((material, index) => addReading({
        id: `course-data:${material.url || index}`,
        title: material.displayName || material.fileName || fileNameFromUrl(material.url) || `Course material ${index + 1}`,
        summary: '',
        url: material.url,
      }));
      (course.background_materials_data || []).forEach((material, index) => addReading({
        id: `background-data:${material.url || index}`,
        title: material.displayName || material.fileName || fileNameFromUrl(material.url) || `Background material ${index + 1}`,
        summary: '',
        url: material.url,
      }));
      (course.course_materials_urls || []).forEach((url, index) => addReading({
        id: `course-url:${url}`,
        title: fileNameFromUrl(url) || `Course material ${index + 1}`,
        summary: '',
        url,
      }));
      (course.background_materials_urls || []).forEach((url, index) => addReading({
        id: `background-url:${url}`,
        title: fileNameFromUrl(url) || `Background material ${index + 1}`,
        summary: '',
        url,
      }));

      const [lectureResult, quizResult, uploadResult] = await Promise.all([
        supabase.from('lecture_courses').select('lecture_id, lectures(id,title,description)').eq('course_id', courseId),
        supabase.from('quiz_batch_courses').select('quiz_batch_id, quiz_batches(id,quiz_name,status,mode,material_source_mode)').eq('course_id', courseId),
        supabase.from('student_uploads').select('id,file_name,file_url').eq('course_id', courseId),
      ]);
      if (lectureResult.error) throw lectureResult.error;
      if (quizResult.error) throw quizResult.error;
      if (uploadResult.error) throw uploadResult.error;

      const lectureIds = (lectureResult.data || []).map((row) => row.lecture_id).filter(Boolean);
      if (lectureIds.length) {
        const { data: artifactRows, error: artifactError } = await supabase
          .from('lecture_artifacts')
          .select('id,lecture_id,artifact_type,artifact_url,file_url,storage_path')
          .in('lecture_id', lectureIds);
        if (artifactError) throw artifactError;
        const lectureTitles = new Map((lectureResult.data || []).map((row: any) => [
          row.lecture_id,
          row.lectures?.title || 'Lecture',
        ]));
        (artifactRows || []).forEach((artifact) => {
          const url = artifact.file_url || artifact.artifact_url || null;
          if (!url || !/\.pdf(?:$|\?)/i.test(url)) return;
          addReading({
            id: `lecture-artifact:${artifact.id}`,
            title: `${lectureTitles.get(artifact.lecture_id) || 'Lecture'} PDF`,
            summary: artifact.artifact_type || 'Lecture artifact',
            url,
            storageBucket: artifact.storage_path ? 'lecture-assets' : null,
            storagePath: artifact.storage_path || null,
          });
        });
      }

      (uploadResult.data || []).forEach((upload) => {
        if (/\.pdf(?:$|\?)/i.test(upload.file_name || upload.file_url || '')) {
          addReading({
            id: `student-upload:${upload.id}`,
            title: upload.file_name || 'Uploaded PDF',
            summary: 'Uploaded course PDF',
            url: upload.file_url,
          });
        }
      });

      setAvailableReadings(readings);
      setAvailableAvatarLectures((lectureResult.data || []).map((row: any) => ({
        id: row.lecture_id,
        title: row.lectures?.title || 'Untitled lecture',
        summary: row.lectures?.description || '',
      })));
      setAvailableQuizzes((quizResult.data || [])
        .filter((row: any) => row.quiz_batches?.mode === 'online'
          && row.quiz_batches?.status === 'published'
          && row.quiz_batches?.material_source_mode !== 'socratic_final')
        .map((row: any) => ({
          id: row.quiz_batch_id,
          title: row.quiz_batches?.quiz_name || 'Untitled quiz',
          summary: 'Published online quiz',
        })));
    } catch (error) {
      console.error('Error loading Socratic resources:', error);
      toast.error('Some course resources could not be loaded.');
    }
  };

  const persistWorkingSession = useCallback((
    sourceBlueprint?: SocraticStudioBlueprint,
    stepOverride?: number,
  ) => {
    if (!profile || !selectedCourseId || !blueprint || !sessionReady || !workingSessionId) return null;
    const currentBlueprint = buildCurrentBlueprint(sourceBlueprint || blueprint);
    const session: SocraticWorkingSession = {
      id: workingSessionId,
      educatorId: profile.id,
      courseId: selectedCourseId,
      currentStep: stepOverride ?? step,
      assignmentTitle,
      description,
      availableAt,
      dueAt,
      lateUntil,
      pointsPossible,
      wordCount,
      questionDocument,
      blueprint: currentBlueprint,
      updatedAt: new Date().toISOString(),
    };
    saveWorkingSession(session);
    return session;
  }, [assignmentTitle, availableAt, blueprint, buildCurrentBlueprint, description, dueAt, lateUntil, pointsPossible, profile, questionDocument, selectedCourseId, sessionReady, step, wordCount, workingSessionId]);

  useEffect(() => {
    if (!sessionReady || step < 2 || !blueprint) return;
    persistWorkingSession();
  }, [assignmentTitle, availableAt, blueprint, description, dueAt, lateUntil, persistWorkingSession, pointsPossible, questionDocument, sessionReady, step, wordCount]);

  useEffect(() => {
    if (!sessionReady || !selectedCourseId || !blueprint) return;
    const pending = loadPendingSocraticCreatedResource();
    if (!pending || pending.courseId !== selectedCourseId) return;
    const id = `${pending.type}:${pending.id}`;
    if (!blueprint.resources.some((resource) => resource.id === id)) {
      const nextResource: SocraticResource = {
        id,
        type: pending.type,
        title: pending.title,
        summary: pending.summary,
        required: false,
        createdFrom: 'new',
        resourceRefId: pending.type === 'reading' ? null : pending.id,
        url: pending.url,
        storageBucket: pending.storageBucket,
        storagePath: pending.storagePath,
        stage: 'research',
      };
      setBlueprint((current) => current
        ? { ...current, resources: [...current.resources, nextResource] }
        : current);
      toast.success(`${pending.title} attached to the assignment.`);
    }
    clearPendingSocraticCreatedResource();
  }, [blueprint, selectedCourseId, sessionReady]);

  const handleSelectCourseContinue = async () => {
    if (!selectedCourseId || !profile) {
      toast.error('Select a course to continue.');
      return;
    }
    if (sessionReady && blueprint?.courseId === selectedCourseId) {
      setStep(2);
      return;
    }
    setOpeningCourseSession(true);
    try {
      await discardWorkingSession();
      await openCourseSession(profile, courses, selectedCourseId, false);
    } catch (error) {
      console.error('Error opening Socratic assignment setup:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to open assignment setup.');
    } finally {
      setOpeningCourseSession(false);
    }
  };

  const handleQuestionFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    event.target.value = '';
    if (!file || !profile || !selectedCourseId || !workingSessionId) return;
    if (file.type !== 'application/pdf') {
      toast.error('The assignment question must be a PDF.');
      return;
    }
    setQuestionFile(file);
    try {
      const storagePath = `${selectedCourseId}/socratic-builder/${workingSessionId}/${Date.now()}-${sanitizeFileName(file.name)}`;
      const result = await uploadFile(file, storagePath, 'course-files');
      if (result.error || !result.url) throw new Error(result.error || 'Question PDF upload failed.');
      const document = {
        name: file.name,
        url: result.url,
        storagePath,
        storageBucket: 'course-files' as const,
      };
      if (questionDocument?.storagePath && questionDocument.storageBucket === 'course-files') {
        const { error: removeError } = await supabase.storage
          .from('course-files')
          .remove([questionDocument.storagePath]);
        if (removeError) console.warn('Could not remove the replaced temporary question PDF:', removeError);
      }
      setQuestionDocument(document);
      setBlueprint((current) => current
        ? { ...current, assignmentDocument: { name: document.name, url: document.url } }
        : current);
      toast.success('Question PDF uploaded.');
    } catch (error) {
      setQuestionFile(null);
      toast.error(error instanceof Error ? error.message : 'Question PDF upload failed.');
    }
  };

  const handleRemoveQuestionFile = async () => {
    if (questionDocument?.storagePath && questionDocument.storageBucket === 'course-files') {
      const { error } = await supabase.storage.from('course-files').remove([questionDocument.storagePath]);
      if (error) console.warn('Could not remove the temporary question PDF:', error);
    }
    setQuestionFile(null);
    setQuestionDocument(null);
    setBlueprint((current) => current ? { ...current, assignmentDocument: undefined } : current);
    if (questionInputRef.current) questionInputRef.current.value = '';
  };

  const handleUploadReading = async (file: File) => {
    if (!selectedCourseId || !blueprint) return;
    if (file.type !== 'application/pdf') throw new Error('Only PDF readings can be uploaded.');
    const storagePath = `${selectedCourseId}/materials/${Date.now()}-${sanitizeFileName(file.name)}`;
    const result = await uploadFile(file, storagePath, 'course-files');
    if (result.error || !result.url) throw new Error(result.error || 'Reading upload failed.');
    const resource: SocraticResource = {
      id: `reading-upload:${Date.now()}`,
      type: 'reading',
      title: file.name.replace(/\.pdf$/i, ''),
      summary: 'Uploaded reading PDF',
      required: false,
      createdFrom: 'upload',
      url: result.url,
      storageBucket: 'course-files',
      storagePath,
      stage: 'research',
    };
    setBlueprint({ ...blueprint, resources: [...blueprint.resources, resource] });
    toast.success(`${file.name} attached.`);
  };

  const navigateToResourceCreator = async (type: 'quiz' | 'avatar_lecture') => {
    persistWorkingSession();
    const returnTo = `/educator/socratic-writing?courseId=${selectedCourseId}&resumeSession=1`;
    if (type === 'quiz') {
      router.push(`/educator/quiz/new?courseId=${selectedCourseId}&socraticMode=online&socraticAttach=quiz&returnTo=${encodeURIComponent(returnTo)}`);
    } else {
      router.push(`/educator/lecture/new?courseId=${selectedCourseId}&socraticAttach=avatar_lecture&returnTo=${encodeURIComponent(returnTo)}`);
    }
  };

  const generateStage = async (
    stage: SocraticStageKey,
    sourceBlueprint: SocraticStudioBlueprint,
  ) => {
    const readinessResult = await generateSocraticReadinessQuestions(sourceBlueprint, questionFile, stage);
    const withGoals: SocraticStudioBlueprint = {
      ...sourceBlueprint,
      stages: {
        ...sourceBlueprint.stages,
        [stage]: {
          ...sourceBlueprint.stages[stage],
          readinessQuestions: readinessResult.stages[stage] || sourceBlueprint.stages[stage].readinessQuestions,
        },
      },
    };
    const starterResult = await generateSocraticStarterResponse(stage, withGoals, questionFile);
    const readinessSignature = getReadinessSignature(stage, withGoals);
    const withResponse: SocraticStudioBlueprint = {
      ...withGoals,
      readinessGenerationSignatures: {
        ...(withGoals.readinessGenerationSignatures || {}),
        [stage]: readinessSignature,
      },
      stages: {
        ...withGoals.stages,
        [stage]: {
          ...withGoals.stages[stage],
          starterResponse: starterResult.response,
        },
      },
    };
    return {
      ...withResponse,
      starterGenerationSignatures: {
        ...(withResponse.starterGenerationSignatures || {}),
        [stage]: getStarterSignature(stage, withResponse),
      },
    };
  };

  const handleRegenerateStage = async (stage: SocraticStageKey) => {
    if (!blueprint) return;
    try {
      const generated = await generateStage(stage, buildCurrentBlueprint(blueprint));
      setBlueprint(generated);
      toast.success(`${generated.stages[stage].label} goals and opening message regenerated.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Generation failed.';
      toast.error(message);
      throw error;
    }
  };

  const isStageGenerationCurrent = (stage: SocraticStageKey, source: SocraticStudioBlueprint) => {
    const config = source.stages[stage];
    return config.readinessQuestions.some((goal) => goal.trim())
      && Boolean(config.starterResponse.trim())
      && source.readinessGenerationSignatures?.[stage] === getReadinessSignature(stage, source)
      && source.starterGenerationSignatures?.[stage] === getStarterSignature(stage, source);
  };

  const allGenerationCurrent = (source: SocraticStudioBlueprint) =>
    SOCRATIC_STAGE_ORDER.every((stage) => isStageGenerationCurrent(stage, source));

  const generateAllStagesAndOpenDesigner = async () => {
    if (!blueprint) return;
    setGenerating(true);
    setGenerationError('');
    try {
      let current = buildCurrentBlueprint(blueprint);
      const readinessResult = await generateSocraticReadinessQuestions(current, questionFile);
      current = {
        ...current,
        stages: SOCRATIC_STAGE_ORDER.reduce((stages, stage) => {
          stages[stage] = {
            ...current.stages[stage],
            readinessQuestions: readinessResult.stages[stage] || current.stages[stage].readinessQuestions,
          };
          return stages;
        }, { ...current.stages }),
      };
      const starterResults = await Promise.all(SOCRATIC_STAGE_ORDER.map(async (stage) => ({
        stage,
        response: (await generateSocraticStarterResponse(stage, current, questionFile)).response,
      })));
      starterResults.forEach(({ stage, response }) => {
        current = {
          ...current,
          stages: {
            ...current.stages,
            [stage]: { ...current.stages[stage], starterResponse: response },
          },
        };
      });
      current = {
        ...current,
        readinessGenerationSignatures: SOCRATIC_STAGE_ORDER.reduce((signatures, stage) => {
          signatures[stage] = getReadinessSignature(stage, current);
          return signatures;
        }, {} as Record<SocraticStageKey, string>),
      };
      current = {
        ...current,
        starterGenerationSignatures: SOCRATIC_STAGE_ORDER.reduce((signatures, stage) => {
          signatures[stage] = getStarterSignature(stage, current);
          return signatures;
        }, {} as Record<SocraticStageKey, string>),
      };
      setBlueprint(current);
      setStep(3);
      persistWorkingSession(current, 3);
      toast.success('Goals and opening messages are ready for all four stages.');
    } catch (error) {
      console.error('Error generating Socratic stage content:', error);
      setGenerationError(error instanceof Error ? error.message : 'The AI could not generate the stage content.');
    } finally {
      setGenerating(false);
    }
  };

  const handleContinue = async () => {
    if (step === 1) {
      await handleSelectCourseContinue();
      return;
    }
    if (step === 2) {
      if (!assignmentTitle.trim() || !description.trim()) {
        toast.error('Assignment title and description are required.');
        return;
      }
      await generateAllStagesAndOpenDesigner();
      return;
    }
    if (step === 3) {
      if (!blueprint) return;
      const current = buildCurrentBlueprint(blueprint);
      if (allGenerationCurrent(current)) {
        setStep(4);
        persistWorkingSession(current, 4);
        return;
      }
      const stagesToRegenerate = SOCRATIC_STAGE_ORDER
        .filter((stage) => !isStageGenerationCurrent(stage, current))
        .map((stage) => current.stages[stage].label);
      toast.error(`Regenerate goals and opening messages for: ${stagesToRegenerate.join(', ')}.`);
      return;
    }
    if (step === 4) {
      setStep(5);
      persistWorkingSession(undefined, 5);
    }
  };

  const handleBack = () => {
    if (step === 1) {
      void discardWorkingSession().finally(() => router.push('/educator/dashboard'));
      return;
    }
    setStep((current) => Math.max(1, current - 1));
  };

  const validatePublishing = () => {
    if (!selectedCourseId || !selectedCourse || !blueprint) return 'Assignment setup is incomplete.';
    if (!assignmentTitle.trim() || !description.trim()) return 'Assignment title and description are required.';
    if (!dueAt) return 'A due date is required.';
    if (availableAt && new Date(availableAt) > new Date(dueAt)) return 'Available From must be before the due date.';
    if (lateUntil && new Date(lateUntil) < new Date(dueAt)) return 'Late Until must be after the due date.';
    if (Number(pointsPossible) < 0) return 'Assignment points cannot be negative.';
    if (Number(wordCount) <= 0) return 'Target word count must be greater than zero.';
    if (!allGenerationCurrent(buildCurrentBlueprint(blueprint))) {
      return 'Stage goals or opening messages are missing or stale. Return to Stage Designer and regenerate them.';
    }
    return null;
  };

  const handlePreview = async () => {
    if (!blueprint) return;
    const validationError = validatePublishing();
    if (validationError && !validationError.startsWith('A due date')) {
      toast.error(validationError);
      return;
    }
    persistWorkingSession(undefined, 5);
    const current = buildCurrentBlueprint(blueprint);
    saveSocraticPreviewPayload({
      blueprint: current,
      session: createPreviewStudioSession(current),
      returnUrl: `/educator/socratic-writing?courseId=${selectedCourseId}&resumeSession=1`,
      createdAt: new Date().toISOString(),
      temporary: true,
    });
    router.push('/educator/assignment/socratic-preview');
  };

  const handlePublish = async () => {
    if (!blueprint || !selectedCourse) return;
    const validationError = validatePublishing();
    if (validationError) {
      toast.error(validationError);
      setShowPublishConfirmation(false);
      return;
    }

    setPublishing(true);
    let assignmentId: string | null = null;
    let publishedQuestionPath: string | null = null;
    try {
      const { data: assignmentRows, error: createError } = await supabase.rpc('create_course_assignment', {
        p_course_id: selectedCourseId,
        p_assignment_title: assignmentTitle.trim(),
        p_description: description.trim(),
        p_points_possible: Math.max(0, Number(pointsPossible) || 0),
        p_status: 'published',
        p_submission_mode: 'text_entry',
        p_allowed_mime_types: [],
        p_max_file_size_bytes: null,
        p_max_files: 0,
        p_available_at: fromDateTimeLocalValue(availableAt),
        p_due_at: fromDateTimeLocalValue(dueAt),
        p_late_until: fromDateTimeLocalValue(lateUntil),
        p_target_course_student_ids: null,
      });
      if (createError) throw createError;
      assignmentId = assignmentRows?.[0]?.id || null;
      if (!assignmentId) throw new Error('Assignment creation did not return an ID.');

      let publishedQuestionDocument: QuestionDocument | null = null;
      if (questionDocument) {
        let publishableQuestionFile = questionFile;
        if (!publishableQuestionFile) {
          let blob: Blob;
          if (questionDocument.storagePath) {
            const { data, error } = await supabase.storage
              .from(questionDocument.storageBucket)
              .download(questionDocument.storagePath);
            if (error || !data) throw new Error(error?.message || 'Failed to load the temporary question PDF for publishing.');
            blob = data;
          } else {
            const response = await fetch(questionDocument.url);
            if (!response.ok) throw new Error('Failed to load the temporary question PDF for publishing.');
            blob = await response.blob();
          }
          publishableQuestionFile = new File([blob], questionDocument.name, { type: 'application/pdf' });
        }
        publishedQuestionPath = `assignment-questions/${assignmentId}/${Date.now()}-${sanitizeFileName(questionDocument.name)}`;
        const uploadResult = await uploadFile(
          publishableQuestionFile,
          publishedQuestionPath,
          'assignment-files',
        );
        if (uploadResult.error || !uploadResult.url) {
          throw new Error(uploadResult.error || 'Failed to publish the assignment question PDF.');
        }
        publishedQuestionDocument = {
          name: questionDocument.name,
          url: uploadResult.url,
          storagePath: publishedQuestionPath,
          storageBucket: 'assignment-files',
        };
        const { error: updateError } = await supabase
          .from('assignments')
          .update({
            question_file_name: publishedQuestionDocument.name,
            question_pdf_url: publishedQuestionDocument.url,
            question_storage_path: publishedQuestionDocument.storagePath,
            updated_at: new Date().toISOString(),
          })
          .eq('id', assignmentId);
        if (updateError) throw updateError;
      }

      await saveSocraticAssignmentConfig(assignmentId, {
        ...buildCurrentBlueprint(blueprint),
        assignmentId,
        courseId: selectedCourseId,
        courseCode: selectedCourse.course_number,
        courseTitle: selectedCourse.title,
        assignmentDocument: publishedQuestionDocument
          ? { name: publishedQuestionDocument.name, url: publishedQuestionDocument.url }
          : undefined,
      });

      if (questionDocument?.storageBucket === 'course-files' && questionDocument.storagePath) {
        const { error: removeError } = await supabase.storage
          .from('course-files')
          .remove([questionDocument.storagePath]);
        if (removeError) console.warn('Could not remove the temporary question PDF after publishing:', removeError);
      }
      clearWorkingSession();
      toast.success(`Assignment published to ${realStudentCount} student${realStudentCount === 1 ? '' : 's'}.`);
      router.push(`/educator/assignment/${assignmentId}`);
    } catch (error) {
      console.error('Error publishing Socratic assignment:', error);
      if (assignmentId) await supabase.from('assignments').delete().eq('id', assignmentId);
      if (publishedQuestionPath) {
        await supabase.storage.from('assignment-files').remove([publishedQuestionPath]);
      }
      toast.error(error instanceof Error ? error.message : 'Failed to publish assignment.');
    } finally {
      setPublishing(false);
      setShowPublishConfirmation(false);
    }
  };

  const enabledStageLabels = blueprint
    ? SOCRATIC_STAGE_ORDER.filter((stage) => stage === 'write' || blueprint.stages[stage].enabled)
      .map((stage) => blueprint.stages[stage].label)
    : [];

  if (loading || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-brand-maroon" />
      </div>
    );
  }

  const renderStepHeader = () => (
    <div className="mb-7">
      <button
        type="button"
        onClick={() => void discardWorkingSession().finally(() => router.push('/educator/dashboard'))}
        className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Dashboard
      </button>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Create Socratic Writing Studio</h1>
          <p className="mt-1 text-gray-500">Configure your staged writing assignment</p>
        </div>
        {step > 1 ? (
          <div className="text-right text-xs text-gray-500">
            <div className="font-semibold text-gray-600">Temporary setup</div>
            <div>Closing this tab discards unpublished work.</div>
          </div>
        ) : null}
      </div>
      <div className="mt-6 flex items-center gap-2 overflow-x-auto pb-2">
        {WIZARD_STEPS.map((label, index) => {
          const itemStep = index + 1;
          const complete = itemStep < step;
          const active = itemStep === step;
          return (
            <div key={label} className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                disabled={itemStep > step}
                onClick={() => itemStep < step && setStep(itemStep)}
                className={classNames(
                  'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium',
                  active && 'bg-brand-maroon text-white',
                  complete && 'bg-emerald-100 text-emerald-700',
                  !active && !complete && 'bg-gray-100 text-gray-500',
                )}
              >
                {complete ? <Check className="h-4 w-4" /> : <span>{itemStep}</span>}
                {label}
              </button>
              {index < WIZARD_STEPS.length - 1 ? (
                <span className={classNames('h-0.5 w-6', complete ? 'bg-emerald-300' : 'bg-gray-200')} />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderCourseStep = () => (
    <section className="rounded-2xl border border-gray-200 bg-white p-7 shadow-sm">
      <h2 className="text-xl font-semibold text-gray-900">Select a Course</h2>
      <p className="mt-1 text-gray-500">Choose which course this assignment belongs to.</p>
      <div className="mt-6 space-y-4">
        {courses.map((course) => {
          const selected = selectedCourseId === course.id;
          return (
            <button
              key={course.id}
              type="button"
              onClick={() => setSelectedCourseId(course.id)}
              className={classNames(
                'flex w-full items-center justify-between rounded-2xl border-2 p-5 text-left transition-colors',
                selected ? 'border-brand-maroon bg-red-50' : 'border-gray-200 bg-white hover:border-gray-300',
              )}
            >
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="rounded-md bg-brand-maroon px-2.5 py-1 text-xs font-semibold text-white">{course.course_number}</span>
                  <span className="font-semibold text-gray-900">{course.title}</span>
                </div>
                <div className="mt-2 text-sm text-gray-500">
                  {studentCounts[course.id] || 0} students enrolled
                </div>
              </div>
              {selected ? <CheckCircle2 className="h-6 w-6 text-brand-maroon" /> : null}
            </button>
          );
        })}
        {courses.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-gray-200 p-10 text-center text-gray-500">
            You do not have any courses yet.
          </div>
        ) : null}
      </div>
    </section>
  );

  const renderAssignmentStep = () => {
    if (!blueprint || !selectedCourse || !sessionReady) {
      return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-maroon" /></div>;
    }
    return (
      <div className="space-y-5">
        <section className="rounded-2xl border border-gray-200 bg-white p-7 shadow-sm">
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-gray-900">Assignment Details</h2>
            <p className="mt-1 text-gray-500">For {selectedCourse.course_number} — {selectedCourse.title}</p>
          </div>

          <div className="space-y-5">
            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-700">Assignment Title <span className="text-red-600">*</span></label>
              <Input value={assignmentTitle} onChange={(event) => setAssignmentTitle(event.target.value)} placeholder="e.g. Ethical Implications of Algorithmic Decision-Making" />
              <p className="mt-2 text-xs text-gray-500">Student label preview: <span className="font-semibold text-gray-700">{assignmentLabel}</span></p>
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-700">Assignment Description <span className="text-red-600">*</span></label>
              <Textarea rows={6} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe the assignment prompt, expectations, and context students should know…" />
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <label className="text-sm font-semibold text-gray-700">Question PDF <span className="font-normal text-gray-400">(optional)</span></label>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-brand-maroon px-3 py-2 text-sm font-semibold text-brand-maroon hover:bg-red-50">
                  <Upload className="h-4 w-4" /> {questionDocument ? 'Replace PDF' : 'Upload PDF'}
                  <input ref={questionInputRef} type="file" accept="application/pdf" onChange={(event) => void handleQuestionFileChange(event)} className="hidden" />
                </label>
              </div>
              {questionDocument ? (
                <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div className="flex min-w-0 items-center gap-3"><FileQuestion className="h-5 w-5 shrink-0 text-brand-maroon" /><span className="truncate text-sm font-medium">{questionDocument.name}</span></div>
                  <button type="button" onClick={() => void handleRemoveQuestionFile()} className="rounded-lg p-2 text-gray-500 hover:text-red-600" aria-label="Remove question PDF"><X className="h-4 w-4" /></button>
                </div>
              ) : (
                <div className="rounded-xl border-2 border-dashed border-gray-200 p-7 text-center text-sm text-gray-400">No question PDF attached</div>
              )}
            </div>
          </div>
        </section>

        <SocraticWizardMaterials
          blueprint={blueprint}
          availableReadings={availableReadings}
          availableQuizzes={availableQuizzes}
          availableAvatarLectures={availableAvatarLectures}
          onChange={setBlueprint}
          onUploadReading={handleUploadReading}
          onCreateQuiz={() => void navigateToResourceCreator('quiz')}
          onCreateAvatarLecture={() => void navigateToResourceCreator('avatar_lecture')}
        />
      </div>
    );
  };

  const renderStageDesigner = () => blueprint ? (
    <SocraticWizardStageDesigner
      blueprint={blueprint}
      onChange={setBlueprint}
      onRegenerateStage={handleRegenerateStage}
      getReadinessSignature={getReadinessSignature}
      getStarterSignature={getStarterSignature}
    />
  ) : null;

  const comingSoonOption = (
    title: string,
    descriptionText: string,
    icon: ReactNode,
  ) => (
    <div
      title="This feature is not yet available."
      className="cursor-not-allowed rounded-2xl border border-gray-200 bg-gray-50 p-5 opacity-65"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="rounded-xl bg-gray-200 p-3 text-gray-500">{icon}</div>
        <span className="rounded-full bg-gray-200 px-3 py-1 text-xs font-semibold text-gray-600">Coming Soon</span>
      </div>
      <h3 className="mt-4 font-semibold text-gray-900">{title}</h3>
      <p className="mt-1 text-sm text-gray-500">{descriptionText}</p>
    </div>
  );

  const renderCompliance = () => (
    <section className="rounded-2xl border border-gray-200 bg-white p-7 shadow-sm">
      <h2 className="text-xl font-semibold text-gray-900">Compliance & Verification</h2>
      <p className="mt-1 text-gray-500">Set how students verify understanding and view upcoming integrity tools.</p>

      <div className="mt-7">
        <h3 className="mb-4 flex items-center gap-2 font-semibold text-gray-800"><ShieldAlert className="h-5 w-5 text-brand-maroon" /> Verification Method</h3>
        <div className="grid gap-4 lg:grid-cols-3">
          {comingSoonOption('Avatar Oral Test', 'Student meets with an AI avatar for a brief oral examination.', <GraduationCap className="h-5 w-5" />)}
          <div className="rounded-2xl border-2 border-brand-maroon bg-red-50 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="rounded-xl bg-brand-maroon p-3 text-white"><FileQuestion className="h-5 w-5" /></div>
              <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-semibold text-brand-maroon"><Lock className="h-3 w-3" /> Required</span>
            </div>
            <h3 className="mt-4 font-semibold text-gray-900">Online Quiz</h3>
            <p className="mt-1 text-sm text-gray-600">Auto-generated quiz drawn from the assignment content.</p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs text-gray-600">
              <span className="rounded-full bg-white px-3 py-1">5 multiple-choice questions</span>
              <span className="rounded-full bg-white px-3 py-1">20 minutes</span>
              <span className="rounded-full bg-white px-3 py-1">Completion required</span>
            </div>
          </div>
          {comingSoonOption('In-Class Quiz', 'Printable quiz flag for manual in-class follow-up.', <FileText className="h-5 w-5" />)}
        </div>
      </div>

      <div className="mt-8">
        <h3 className="mb-4 flex items-center gap-2 font-semibold text-gray-800"><Info className="h-5 w-5 text-amber-500" /> Academic Integrity Flags</h3>
        <div className="grid gap-4 lg:grid-cols-3">
          {comingSoonOption('No AI Clarify Function', 'Flags attempts to use AI assistance when it is disabled.', <ShieldAlert className="h-5 w-5" />)}
          {comingSoonOption('Copy-Paste Detection', 'Detects when students paste large blocks of text.', <FileText className="h-5 w-5" />)}
          {comingSoonOption('Typing Rhythm Analysis', 'Identifies unusual typing patterns that may indicate external generation.', <Clock3 className="h-5 w-5" />)}
        </div>
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          The current evidence-based process consistency report remains enabled after submission.
        </div>
      </div>
    </section>
  );

  const renderReview = () => {
    if (!blueprint || !selectedCourse) return null;
    return (
      <div className="space-y-5">
        <section className="rounded-2xl border border-gray-200 bg-white p-7 shadow-sm">
          <h2 className="text-xl font-semibold text-gray-900">Grading & Availability</h2>
          <p className="mt-1 text-gray-500">Set timing, marks, and writing expectations before publishing.</p>
          <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-5">
            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-700">Available From <span className="font-normal text-gray-400">(optional)</span></label>
              <Input type="datetime-local" value={availableAt} onChange={(event) => setAvailableAt(event.target.value)} />
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-700">Due Date <span className="text-red-600">*</span></label>
              <Input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-700">Late Until <span className="font-normal text-gray-400">(optional)</span></label>
              <Input type="datetime-local" value={lateUntil} onChange={(event) => setLateUntil(event.target.value)} />
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-700">Assignment Points</label>
              <Input type="number" min="0" value={pointsPossible} onChange={(event) => setPointsPossible(event.target.value)} />
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-700">Target Word Count</label>
              <Input type="number" min="1" value={wordCount} onChange={(event) => setWordCount(event.target.value)} />
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-7 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Review & Publish</h2>
              <p className="mt-1 text-gray-500">Confirm the student-facing setup and publish when ready.</p>
            </div>
            <button type="button" onClick={() => void handlePreview()} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
              <Eye className="h-4 w-4" /> Preview as Student
            </button>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <SummaryCard label="Course" value={`${selectedCourse.course_number} — ${selectedCourse.title}`} />
            <SummaryCard label="Assignment" value={assignmentTitle || 'Untitled assignment'} detail={description} />
            <SummaryCard label="Enabled Stages" value={enabledStageLabels.join(', ')} />
            <SummaryCard label="Research Materials" value={blueprint.resources.length ? `${blueprint.resources.length} attached` : 'None'} detail={blueprint.resources.map((resource) => resource.title).join(', ')} />
            <SummaryCard label="Verification" value="Online Quiz" detail="5 multiple-choice questions · 20 minutes · completion required" />
            <SummaryCard label="Academic Integrity" value="Evidence-based process consistency report" detail="Additional integrity flags are coming soon." />
            <SummaryCard label="Students" value={`${realStudentCount} students`} detail="Educator test enrollment excluded from this count." />
            <SummaryCard label="Grading" value={`${Number(pointsPossible) || 0} points · ${Number(wordCount) || 1500} words`} detail={dueAt ? `Due ${new Date(dueAt).toLocaleString()}` : 'Due date required'} />
          </div>
        </section>
      </div>
    );
  };

  return (
    <EducatorLayout profile={profile}>
      <main className="mx-auto max-w-[1520px] px-1 pb-10">
        {renderStepHeader()}
        {step === 1 ? renderCourseStep() : null}
        {step === 2 ? renderAssignmentStep() : null}
        {step === 3 ? renderStageDesigner() : null}
        {step === 4 ? renderCompliance() : null}
        {step === 5 ? renderReview() : null}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <button type="button" onClick={handleBack} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-5 py-3 font-semibold text-gray-700 hover:bg-gray-50">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <div className="flex flex-wrap items-center gap-3">
            {step < 5 ? (
              <button
                type="button"
                onClick={() => void handleContinue()}
                disabled={(step === 1 && (!selectedCourseId || openingCourseSession)) || generating}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-maroon px-6 py-3 font-semibold text-white hover:bg-brand-maroon-hover disabled:cursor-not-allowed disabled:opacity-45"
              >
                {step === 1 && openingCourseSession ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Continue <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowPublishConfirmation(true)}
                disabled={publishing}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-maroon px-6 py-3 font-semibold text-white hover:bg-brand-maroon-hover disabled:opacity-50"
              >
                <Send className="h-4 w-4" /> Publish to {realStudentCount} Student{realStudentCount === 1 ? '' : 's'}
              </button>
            )}
          </div>
        </div>
      </main>

      {generating ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-5 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white p-8 text-center shadow-2xl">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-50"><Sparkles className="h-7 w-7 animate-pulse text-brand-maroon" /></div>
            <h2 className="mt-5 text-xl font-semibold text-gray-900">Preparing Stage Designer</h2>
            <p className="mt-2 text-sm leading-6 text-gray-600">The AI is creating hidden readiness goals first, then opening messages for Clarify, Research, Build, and Write.</p>
            <div className="mt-5 rounded-xl bg-gray-50 p-4 text-left text-sm text-gray-600">
              <div className="font-semibold text-gray-800">Generation context</div>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Course, assignment title, description, and target word count</li>
                <li>{questionDocument ? `Question PDF: ${questionDocument.name}` : 'No question PDF attached'}</li>
                <li>{blueprint?.resources.length || 0} explicitly attached research material{blueprint?.resources.length === 1 ? '' : 's'}</li>
                <li>Stage purpose and educator guidance for each stage</li>
              </ul>
            </div>
            <div className="mt-5 flex items-center justify-center gap-2 text-sm font-semibold text-brand-maroon"><Loader2 className="h-4 w-4 animate-spin" /> Please keep this page open</div>
          </div>
        </div>
      ) : null}

      {generationError ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-5 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white p-8 shadow-2xl">
            <h2 className="text-xl font-semibold text-gray-900">Stage generation did not finish</h2>
            <p className="mt-2 break-words text-sm leading-6 text-gray-600">{generationError}</p>
            <p className="mt-3 text-sm text-gray-500">You remain in Assignment Setup. No assignment was published.</p>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setGenerationError('')} className="rounded-lg border border-gray-300 px-4 py-2 font-semibold text-gray-700">Close</button>
              <button type="button" onClick={() => void generateAllStagesAndOpenDesigner()} className="rounded-lg bg-brand-maroon px-4 py-2 font-semibold text-white">Retry</button>
            </div>
          </div>
        </div>
      ) : null}

      {showPublishConfirmation ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-5 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white p-8 shadow-2xl">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-50"><Send className="h-6 w-6 text-brand-maroon" /></div>
            <h2 className="mt-5 text-center text-xl font-semibold text-gray-900">Publish this assignment?</h2>
            <p className="mt-2 text-center text-sm leading-6 text-gray-600">{assignmentTitle || 'This assignment'} will be published to {realStudentCount} student{realStudentCount === 1 ? '' : 's'} in {selectedCourse?.course_number}.</p>
            <div className="mt-6 flex justify-center gap-3">
              <button type="button" onClick={() => setShowPublishConfirmation(false)} disabled={publishing} className="rounded-lg border border-gray-300 px-5 py-2.5 font-semibold text-gray-700">Cancel</button>
              <button type="button" onClick={() => void handlePublish()} disabled={publishing} className="inline-flex items-center gap-2 rounded-lg bg-brand-maroon px-5 py-2.5 font-semibold text-white disabled:opacity-50">
                {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {publishing ? 'Publishing…' : 'Confirm & Publish'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </EducatorLayout>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-xl bg-gray-50 p-5">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-2 font-semibold text-gray-900">{value}</div>
      {detail ? <div className="mt-1 line-clamp-3 text-sm text-gray-500">{detail}</div> : null}
    </div>
  );
}
