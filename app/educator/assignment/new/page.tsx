'use client';

import { ChangeEvent, MouseEvent, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, BookOpen, Brain, Calendar, FileText, Save, Send, Upload, Users } from 'lucide-react';
import { toast } from 'sonner';
import EducatorLayout from '@/components/EducatorLayout';
import SocraticStudioConfigurator from '@/components/socratic-writing/SocraticStudioConfigurator';
import { supabase, Course, Profile } from '@/lib/supabase';
import { uploadFile } from '@/lib/fileUpload';
import {
  getAssignmentSystemMissingMessage,
  isAssignmentSystemMissingError,
} from '@/lib/assignmentSystemErrors';
import {
  ASSIGNMENT_ALLOWED_FILE_TYPES,
  AssignmentSubmissionMode,
  DEFAULT_ASSIGNMENT_ALLOWED_MIME_TYPES,
  formatFileSizeLabel,
  sanitizeFileName,
} from '@/lib/assignments';
import {
  clearStudioDraft,
  clearPendingSocraticCreatedResource,
  createDefaultStudioBlueprint,
  loadPendingSocraticCreatedResource,
  loadStudioDraft,
  saveStudioDraft,
  SOCRATIC_STAGE_ORDER,
  SocraticResource,
  SocraticStageKey,
  SocraticStudioBlueprint,
} from '@/lib/socraticWriting';
import { generateSocraticStarterResponse, saveSocraticAssignmentConfig } from '@/lib/socraticWritingApi';

type CourseRosterEntry = {
  course_student_id: string;
  student_id: string | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
};

type ExistingReadingOption = {
  id: string;
  title: string;
  summary: string;
  url?: string | null;
  storageBucket?: string | null;
  storagePath?: string | null;
};

type ExistingLinkedOption = {
  id: string;
  title: string;
  summary: string;
};

const LEGACY_SOCRATIC_RESOURCE_TITLES = new Set([
  'Epistemology Reading Pack',
  'Avatar Lecture: Framing Knowledge and Justification',
  'Personalized Knowledge Check',
  'Optional Lecture: Counterarguments in Philosophy Essays',
]);

const toDateTimeLocalValue = (value: string | null) => {
  if (!value) return '';

  const date = new Date(value);
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
};

const fromDateTimeLocalValue = (value: string) => {
  if (!value) return null;
  return new Date(value).toISOString();
};

const mergeSocraticStageDefaults = (
  draft: SocraticStudioBlueprint,
  seed: SocraticStudioBlueprint,
): SocraticStudioBlueprint['stages'] => {
  return SOCRATIC_STAGE_ORDER.reduce((stages, stage) => {
    stages[stage] = {
      ...seed.stages[stage],
      ...(draft.stages?.[stage] || {}),
      systemPrompt: seed.stages[stage].systemPrompt,
      starterQuestions: [],
      customInstructions: draft.stages?.[stage]?.customInstructions || '',
      starterResponse: draft.stages?.[stage]?.starterResponse || '',
    };
    return stages;
  }, {} as SocraticStudioBlueprint['stages']);
};

export default function NewAssignmentPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const presetCourseId = searchParams.get('courseId');
  const shouldResumeSocraticDraft = searchParams.get('resumeSocraticDraft') === '1';

  const [profile, setProfile] = useState<Profile | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [roster, setRoster] = useState<CourseRosterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingStatus, setSavingStatus] = useState<'draft' | 'published' | null>(null);
  const [questionFile, setQuestionFile] = useState<File | null>(null);
  const [previewNumber, setPreviewNumber] = useState(1);
  const [assignmentSystemMissing, setAssignmentSystemMissing] = useState(false);
  const [assignmentExperience, setAssignmentExperience] = useState<'standard' | 'socratic'>(
    searchParams.get('mode') === 'socratic' ? 'socratic' : 'standard',
  );
  const [studioBlueprint, setStudioBlueprint] = useState<SocraticStudioBlueprint | null>(null);
  const [availableReadings, setAvailableReadings] = useState<ExistingReadingOption[]>([]);
  const [availableQuizzes, setAvailableQuizzes] = useState<ExistingLinkedOption[]>([]);
  const [availableAvatarLectures, setAvailableAvatarLectures] = useState<ExistingLinkedOption[]>([]);

  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [assignmentTitle, setAssignmentTitle] = useState('');
  const [description, setDescription] = useState('');
  const [pointsPossible, setPointsPossible] = useState('100');
  const [submissionMode, setSubmissionMode] = useState<AssignmentSubmissionMode>('file_upload');
  const [maxFiles, setMaxFiles] = useState('1');
  const [maxFileSizeMb, setMaxFileSizeMb] = useState('25');
  const [allowedMimeTypes, setAllowedMimeTypes] = useState<string[]>(DEFAULT_ASSIGNMENT_ALLOWED_MIME_TYPES);
  const [availableAt, setAvailableAt] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [lateUntil, setLateUntil] = useState('');

  const selectedCourse = useMemo(
    () => courses.find((course) => course.id === selectedCourseId) ?? null,
    [courses, selectedCourseId],
  );

  const assignmentLabelPreview = selectedCourse
    ? `${selectedCourse.title} Assignment ${previewNumber}`
    : 'Select a course to generate the assignment label';

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    if (!selectedCourseId) {
      setRoster([]);
      setPreviewNumber(1);
      setAvailableReadings([]);
      setAvailableQuizzes([]);
      setAvailableAvatarLectures([]);
      return;
    }

    void Promise.all([
      loadRoster(selectedCourseId),
      loadAssignmentPreview(selectedCourseId),
      loadSocraticResourceLibrary(selectedCourseId),
    ]);
  }, [selectedCourseId]);

  useEffect(() => {
    const seed = createDefaultStudioBlueprint({
      assignmentId: `draft-${selectedCourseId || 'course'}`,
      courseId: selectedCourseId || 'course',
      courseCode: selectedCourse?.course_number || 'COURSE',
      courseTitle: selectedCourse?.title || 'Course',
      assignmentTitle: assignmentTitle.trim() || 'Socratic Writing Assignment',
      assignmentBrief: description.trim() || 'Use Clarify, Research, Build, and Write to produce the final essay.',
      dueAt: fromDateTimeLocalValue(dueAt) || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      pointsPossible: Number(pointsPossible) || 100,
    });

    const pendingResource = loadPendingSocraticCreatedResource();
    const canRestoreDraft =
      Boolean(selectedCourseId)
      && (shouldResumeSocraticDraft || pendingResource?.courseId === selectedCourseId);

    const savedDraft = canRestoreDraft && selectedCourseId ? loadStudioDraft(selectedCourseId) : null;

    if (selectedCourseId && !canRestoreDraft) {
      clearStudioDraft(selectedCourseId);
    }

    const nextBlueprint = savedDraft
      ? {
          ...savedDraft,
          assignmentId: seed.assignmentId,
          courseId: seed.courseId,
          courseCode: seed.courseCode,
          courseTitle: seed.courseTitle,
          assignmentTitle: seed.assignmentTitle,
          assignmentBrief: seed.assignmentBrief,
          dueAt: seed.dueAt,
          pointsPossible: seed.pointsPossible,
          stages: mergeSocraticStageDefaults(savedDraft, seed),
          resources:
            (savedDraft.resources || []).length > 0
            && (savedDraft.resources || []).every(
              (resource) =>
                resource.type === 'lecture'
                || LEGACY_SOCRATIC_RESOURCE_TITLES.has(resource.title),
            )
              ? []
              : (savedDraft.resources || []),
        }
      : seed;

    setStudioBlueprint(nextBlueprint);
  }, [selectedCourse, selectedCourseId, shouldResumeSocraticDraft]);

  useEffect(() => {
    setStudioBlueprint((current) => {
      if (!current) return current;
      return {
        ...current,
        assignmentId: `draft-${selectedCourseId || 'course'}`,
        courseId: selectedCourseId || 'course',
        courseCode: selectedCourse?.course_number || 'COURSE',
        courseTitle: selectedCourse?.title || 'Course',
        assignmentTitle: assignmentTitle.trim() || 'Socratic Writing Assignment',
        assignmentBrief:
          description.trim() || 'Use Clarify, Research, Build, and Write to produce the final essay.',
        dueAt:
          fromDateTimeLocalValue(dueAt)
          || current.dueAt
          || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        pointsPossible: Number(pointsPossible) || 100,
      };
    });
  }, [assignmentTitle, description, dueAt, pointsPossible, selectedCourse, selectedCourseId]);

  useEffect(() => {
    if (assignmentExperience !== 'socratic' || !selectedCourseId || !studioBlueprint) return;
    saveStudioDraft(selectedCourseId, studioBlueprint);
  }, [assignmentExperience, selectedCourseId, studioBlueprint]);

  useEffect(() => {
    if (assignmentExperience !== 'socratic' || !selectedCourseId || !studioBlueprint) return;
    const pendingResource = loadPendingSocraticCreatedResource();
    if (!pendingResource || pendingResource.courseId !== selectedCourseId) return;

    setStudioBlueprint((current) => {
      if (!current) return current;

      const nextResource: SocraticResource = {
        id:
          pendingResource.type === 'reading'
            ? pendingResource.id
            : `${pendingResource.type === 'quiz' ? 'quiz' : 'avatar'}-${pendingResource.id}`,
        type: pendingResource.type,
        title: pendingResource.title,
        summary: pendingResource.summary,
        required: false,
        createdFrom: 'new',
        resourceRefId: pendingResource.type === 'reading' ? undefined : pendingResource.id,
        url: pendingResource.url || null,
        storageBucket: pendingResource.storageBucket || null,
        storagePath: pendingResource.storagePath || null,
        stage: 'research',
      };

      const exists = current.resources.some((resource) => resource.id === nextResource.id);
      if (exists) return current;

      return {
        ...current,
        resources: [...current.resources, nextResource],
      };
    });
    clearPendingSocraticCreatedResource();
  }, [assignmentExperience, selectedCourseId, studioBlueprint]);

  const bootstrap = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push('/educator/login');
        return;
      }

      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (!profileData || profileData.role !== 'educator') {
        await supabase.auth.signOut();
        router.push('/educator/login');
        return;
      }

      setProfile(profileData);

      const { data: courseRows, error: courseError } = await supabase
        .from('courses')
        .select('*')
        .eq('educator_id', user.id)
        .order('title', { ascending: true });

      if (courseError) {
        throw courseError;
      }

      const ownedCourses = courseRows || [];
      setCourses(ownedCourses);

      if (presetCourseId && ownedCourses.some((course) => course.id === presetCourseId)) {
        setSelectedCourseId(presetCourseId);
      } else if (ownedCourses.length === 1) {
        setSelectedCourseId(ownedCourses[0].id);
      }
    } catch (error) {
      console.error('Error loading assignment creation context:', error);
      toast.error('Failed to load assignment setup.');
    } finally {
      setLoading(false);
    }
  };

  const loadRoster = async (courseId: string) => {
    const { data, error } = await supabase.rpc('get_course_student_roster', {
      p_course_id: courseId,
    });

    if (error) {
      console.error('Error loading roster:', error);
      toast.error('Failed to load enrolled students for the selected course.');
      setRoster([]);
      return;
    }

    setRoster((data || []) as CourseRosterEntry[]);
  };

  const loadAssignmentPreview = async (courseId: string) => {
    const { data, error } = await supabase
      .from('assignments')
      .select('assignment_number')
      .eq('course_id', courseId)
      .order('assignment_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Error loading assignment number preview:', error);
      if (isAssignmentSystemMissingError(error)) {
        setAssignmentSystemMissing(true);
        toast.error(getAssignmentSystemMissingMessage());
      }
      setPreviewNumber(1);
      return;
    }

    setPreviewNumber((data?.assignment_number || 0) + 1);
  };

  const loadSocraticResourceLibrary = async (courseId: string) => {
    try {
      const courseRecord = courses.find((course) => course.id === courseId) || null;

      const readingOptions: ExistingReadingOption[] = [];
      const seen = new Set<string>();
      const appendReading = (reading: ExistingReadingOption) => {
        if (!reading.id || seen.has(reading.id)) return;
        seen.add(reading.id);
        readingOptions.push(reading);
      };

      const addCourseMaterialList = (
        items: Array<Record<string, unknown>> | null | undefined,
        prefix: string,
        fallbackLabel: string,
      ) => {
        items?.forEach((item, index) => {
          if (!item || typeof item !== 'object') return;
          const title = String(item.name || item.title || `${fallbackLabel} ${index + 1}`);
          const summary = String(item.description || item.summary || '');
          const url = typeof item.url === 'string' ? item.url : typeof item.file_url === 'string' ? item.file_url : null;
          const storagePath = typeof item.storage_path === 'string' ? item.storage_path : null;
          appendReading({
            id: `${prefix}:${storagePath || url || index}`,
            title,
            summary,
            url,
            storageBucket: storagePath ? 'course-files' : null,
            storagePath,
          });
        });
      };

      addCourseMaterialList(courseRecord?.course_materials_data as Array<Record<string, unknown>> | undefined, 'course-material', 'Course material');
      addCourseMaterialList(courseRecord?.background_materials_data as Array<Record<string, unknown>> | undefined, 'background-material', 'Background material');

      (courseRecord?.course_materials_urls || []).forEach((url, index) => {
        appendReading({
          id: `course-url:${url}`,
          title: `Course material ${index + 1}`,
          summary: '',
          url,
        });
      });

      (courseRecord?.background_materials_urls || []).forEach((url, index) => {
        appendReading({
          id: `background-url:${url}`,
          title: `Background material ${index + 1}`,
          summary: '',
          url,
        });
      });

      const [{ data: lectureRows, error: lectureError }, { data: quizRows, error: quizError }, { data: uploadRows, error: uploadError }] = await Promise.all([
        supabase
          .from('lecture_courses')
          .select('lecture_id, lectures(id, title, description)')
          .eq('course_id', courseId),
        supabase
          .from('quiz_batch_courses')
          .select('quiz_batch_id, quiz_batches(id, quiz_name, status)')
          .eq('course_id', courseId),
        supabase
          .from('student_uploads')
          .select('id, file_name, file_url')
          .eq('course_id', courseId),
      ]);

      if (lectureError) throw lectureError;
      if (quizError) throw quizError;
      if (uploadError) throw uploadError;

      const lectureIds = (lectureRows || []).map((row: any) => row.lecture_id).filter(Boolean);
      const { data: lectureArtifacts, error: lectureArtifactsError } = lectureIds.length
        ? await supabase
            .from('lecture_artifacts')
            .select('id, lecture_id, artifact_type, artifact_url, file_url, storage_path')
            .in('lecture_id', lectureIds)
        : { data: [], error: null as any };

      if (lectureArtifactsError) throw lectureArtifactsError;

      const avatarLectureOptions: ExistingLinkedOption[] = (lectureRows || []).map((row: any) => ({
        id: row.lecture_id,
        title: row.lectures?.title || 'Untitled lecture',
        summary: row.lectures?.description || '',
      }));

      const artifactsByLectureId = (lectureArtifacts || []).reduce<Record<string, any[]>>((acc, artifact: any) => {
        const lectureId = artifact.lecture_id;
        if (!lectureId) return acc;
        if (!acc[lectureId]) {
          acc[lectureId] = [];
        }
        acc[lectureId].push(artifact);
        return acc;
      }, {});

      (lectureRows || []).forEach((row: any) => {
        const lectureTitle = row.lectures?.title || 'Lecture';
        (artifactsByLectureId[row.lecture_id] || []).forEach((artifact: any) => {
          const fileUrl = artifact.file_url || artifact.artifact_url || null;
          if (!fileUrl || !String(fileUrl).toLowerCase().includes('.pdf')) return;
          appendReading({
            id: `lecture-artifact:${artifact.id}`,
            title: `${lectureTitle} PDF`,
            summary: artifact.artifact_type || 'Lecture artifact',
            url: fileUrl,
            storageBucket: artifact.storage_path ? 'lecture-assets' : null,
            storagePath: artifact.storage_path || null,
          });
        });
      });

      (uploadRows || []).forEach((upload: any) => {
        const fileName = upload.file_name || 'Student upload';
        const fileUrl = upload.file_url || null;
        if (!String(fileName).toLowerCase().includes('.pdf') && !String(fileUrl).toLowerCase().includes('.pdf')) {
          return;
        }
        appendReading({
          id: `student-upload:${upload.id}`,
          title: fileName,
          summary: 'Uploaded course PDF',
          url: fileUrl,
        });
      });

      setAvailableReadings(readingOptions);
      setAvailableAvatarLectures(avatarLectureOptions);
      setAvailableQuizzes(
        (quizRows || []).map((row: any) => ({
          id: row.quiz_batch_id,
          title: row.quiz_batches?.quiz_name || 'Untitled quiz',
          summary: row.quiz_batches?.status || '',
        })),
      );
    } catch (error) {
      console.error('Error loading Socratic resource library:', error);
      toast.error('Failed to load Socratic course resources.');
      setAvailableReadings([]);
      setAvailableQuizzes([]);
      setAvailableAvatarLectures([]);
    }
  };

  const handleUploadSocraticReading = async (file: File) => {
    if (!selectedCourseId || !studioBlueprint) return;
    if (file.type !== 'application/pdf') {
      throw new Error('Only PDF readings can be uploaded here.');
    }

    const storagePath = `${selectedCourseId}/materials/${Date.now()}-${sanitizeFileName(file.name)}`;
    const uploadResult = await uploadFile(file, storagePath, 'course-files');
    if (uploadResult.error || !uploadResult.url) {
      throw new Error(uploadResult.error || 'Failed to upload reading PDF.');
    }

    const nextResource: SocraticResource = {
      id: `reading-upload-${Date.now()}`,
      type: 'reading',
      title: file.name.replace(/\.pdf$/i, ''),
      summary: 'Uploaded reading PDF',
      required: false,
      createdFrom: 'upload',
      url: uploadResult.url,
      storageBucket: 'course-files',
      storagePath,
      stage: 'research',
    };

    setStudioBlueprint({
      ...studioBlueprint,
      resources: [...studioBlueprint.resources, nextResource],
    });
  };

  const buildCurrentSocraticBlueprint = (blueprint: SocraticStudioBlueprint) => ({
    ...blueprint,
    assignmentId: blueprint.assignmentId || `draft-${selectedCourseId || 'course'}`,
    courseId: selectedCourseId || blueprint.courseId,
    courseCode: selectedCourse?.course_number || blueprint.courseCode,
    courseTitle: selectedCourse?.title || blueprint.courseTitle,
    assignmentTitle: assignmentTitle.trim() || blueprint.assignmentTitle,
    assignmentBrief: description.trim() || blueprint.assignmentBrief,
    dueAt: fromDateTimeLocalValue(dueAt) || blueprint.dueAt,
    pointsPossible: Number(pointsPossible) || blueprint.pointsPossible,
  });

  const handleGenerateSocraticStarterResponse = async (stage: SocraticStageKey) => {
    if (!studioBlueprint) return;
    if (!selectedCourseId) {
      toast.error('Select a course before generating starter responses.');
      return;
    }
    if (!assignmentTitle.trim()) {
      toast.error('Add an assignment title before generating starter responses.');
      return;
    }
    if (!description.trim() && !questionFile && studioBlueprint.resources.length === 0) {
      toast.error('Add a description, question PDF, or research resource before generating starter responses.');
      return;
    }

    const currentBlueprint = buildCurrentSocraticBlueprint(studioBlueprint);
    const { response } = await generateSocraticStarterResponse(stage, currentBlueprint, questionFile);
    setStudioBlueprint((current) => {
      if (!current) return current;
      return {
        ...current,
        stages: {
          ...current.stages,
          [stage]: {
            ...current.stages[stage],
            starterResponse: response,
          },
        },
      };
    });
    toast.success(`${currentBlueprint.stages[stage].label} starter response generated.`);
  };

  const navigateToCreateQuiz = () => {
    const returnTo = `/educator/assignment/new?courseId=${selectedCourseId}&mode=socratic&resumeSocraticDraft=1`;
    router.push(
      `/educator/quiz/new?courseId=${selectedCourseId}&socraticMode=online&socraticAttach=quiz&returnTo=${encodeURIComponent(returnTo)}`,
    );
  };

  const navigateToCreateAvatarLecture = () => {
    const returnTo = `/educator/assignment/new?courseId=${selectedCourseId}&mode=socratic&resumeSocraticDraft=1`;
    router.push(
      `/educator/lecture/new?courseId=${selectedCourseId}&socraticAttach=avatar_lecture&returnTo=${encodeURIComponent(returnTo)}`,
    );
  };

  const toggleAllowedMimeType = (mime: string) => {
    setAllowedMimeTypes((current) =>
      current.includes(mime)
        ? current.filter((value) => value !== mime)
        : [...current, mime],
    );
  };

  const handleQuestionFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;

    if (!file) {
      setQuestionFile(null);
      return;
    }

    if (file.type !== 'application/pdf') {
      toast.error('Assignment questions must be uploaded as a PDF.');
      event.target.value = '';
      return;
    }

    setQuestionFile(file);
  };

  const handleCreateAssignment = async (
    event: MouseEvent<HTMLButtonElement>,
    status: 'draft' | 'published',
  ) => {
    event.preventDefault();

    if (!selectedCourseId) {
      toast.error('Select a course first.');
      return;
    }

    if (!assignmentTitle.trim()) {
      toast.error('Add an assignment title.');
      return;
    }

    if (!dueAt) {
      toast.error('Set a due date before creating the assignment.');
      return;
    }

    if (assignmentSystemMissing) {
      toast.error(getAssignmentSystemMissingMessage());
      return;
    }

    if (
      (submissionMode === 'file_upload' || submissionMode === 'file_and_text')
      && allowedMimeTypes.length === 0
    ) {
      toast.error('Pick at least one allowed submission file type.');
      return;
    }

    if (assignmentExperience === 'socratic') {
      if (!studioBlueprint) {
        toast.error('Socratic Writing Studio is not ready yet.');
        return;
      }

      if (status === 'published') {
        if (!description.trim()) {
          toast.error('Add assignment description/instructions before publishing a Socratic assignment.');
          return;
        }
        if (!questionFile) {
          toast.error('Upload the assignment question PDF before publishing a Socratic assignment.');
          return;
        }

        const missingStarterStages = SOCRATIC_STAGE_ORDER.filter(
          (stage) => !studioBlueprint.stages[stage].starterResponse?.trim(),
        );
        if (missingStarterStages.length > 0) {
          toast.error(
            `Generate starter responses before publishing: ${missingStarterStages
              .map((stage) => studioBlueprint.stages[stage].label)
              .join(', ')}.`,
          );
          return;
        }
      }
    }

    setSavingStatus(status);

    let assignmentId: string | null = null;

    try {
      const effectiveSubmissionMode: AssignmentSubmissionMode =
        assignmentExperience === 'socratic' ? 'text_entry' : submissionMode;

      const { data: assignmentRows, error: createError } = await supabase.rpc(
        'create_course_assignment',
        {
          p_course_id: selectedCourseId,
          p_assignment_title: assignmentTitle.trim(),
          p_description: description,
          p_points_possible: Number(pointsPossible) || 0,
          p_status: status,
          p_submission_mode: effectiveSubmissionMode,
          p_allowed_mime_types:
            effectiveSubmissionMode === 'text_entry' ? [] : allowedMimeTypes,
          p_max_file_size_bytes:
            effectiveSubmissionMode === 'text_entry'
              ? null
              : (Number(maxFileSizeMb) || 0) * 1024 * 1024,
          p_max_files: effectiveSubmissionMode === 'text_entry' ? 0 : Number(maxFiles) || 1,
          p_available_at: fromDateTimeLocalValue(availableAt),
          p_due_at: fromDateTimeLocalValue(dueAt),
          p_late_until: fromDateTimeLocalValue(lateUntil),
          p_target_course_student_ids: null,
        },
      );

      if (createError) {
        if (isAssignmentSystemMissingError(createError)) {
          setAssignmentSystemMissing(true);
          throw new Error(getAssignmentSystemMissingMessage());
        }
        throw createError;
      }

      assignmentId = assignmentRows?.[0]?.id ?? null;

      if (!assignmentId) {
        throw new Error('Assignment creation did not return an ID.');
      }

      if (questionFile) {
        const storagePath = `assignment-questions/${assignmentId}/${Date.now()}-${sanitizeFileName(questionFile.name)}`;
        const uploadResult = await uploadFile(questionFile, storagePath, 'assignment-files');

        if (uploadResult.error || !uploadResult.url) {
          throw new Error(uploadResult.error || 'Failed to upload assignment question PDF.');
        }

        const { error: updateError } = await supabase
          .from('assignments')
          .update({
            question_file_name: questionFile.name,
            question_pdf_url: uploadResult.url,
            question_storage_path: storagePath,
            updated_at: new Date().toISOString(),
          })
          .eq('id', assignmentId);

        if (updateError) {
          throw updateError;
        }
      }

      if (assignmentExperience === 'socratic' && studioBlueprint) {
        await saveSocraticAssignmentConfig(assignmentId, {
          ...buildCurrentSocraticBlueprint(studioBlueprint),
          assignmentId,
          courseId: selectedCourseId,
        });
      }

      toast.success(
        status === 'published'
          ? 'Assignment published successfully.'
          : 'Assignment saved as draft.',
      );

      router.push(`/educator/assignment/${assignmentId}`);
    } catch (error) {
      console.error('Error creating assignment:', error);

      if (assignmentId) {
        await supabase.from('assignments').delete().eq('id', assignmentId);
      }

      const message = error instanceof Error ? error.message : 'Failed to create assignment.';
      toast.error(message);
    } finally {
      setSavingStatus(null);
    }
  };

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <EducatorLayout profile={profile}>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors mb-4"
          >
            <ArrowLeft className="w-5 h-5" />
            Back
          </button>
          <h1 className="text-3xl font-bold text-gray-900">Create Assignment</h1>
          <p className="text-gray-600 mt-2">
            Build a Brightspace-style assignment with a question PDF, schedule, submission settings,
            and student targeting based on the selected course roster.
          </p>
        </div>

        <form className="space-y-6">
          {assignmentSystemMissing && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {getAssignmentSystemMissingMessage()}
            </div>
          )}

          <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="bg-brand-maroon/10 p-3 rounded-xl">
                <FileText className="w-6 h-6 text-brand-maroon" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Assignment Basics</h2>
                <p className="text-sm text-gray-600">Select the course, set the student-facing label, and upload the assignment PDF.</p>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">Course</label>
                <select
                  value={selectedCourseId}
                  onChange={(event) => setSelectedCourseId(event.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-brand-maroon"
                >
                  <option value="">Select a course</option>
                  {courses.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.course_number ? `${course.course_number} - ${course.title}` : course.title}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">Assignment Label Preview</label>
                <div className="w-full px-3 py-2 rounded-lg border border-dashed border-brand-maroon/30 bg-brand-maroon/5 text-brand-maroon font-semibold">
                  {assignmentLabelPreview}
                </div>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">Assignment Title</label>
                <input
                  type="text"
                  value={assignmentTitle}
                  onChange={(event) => setAssignmentTitle(event.target.value)}
                  placeholder="Linear Regression Implementation"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-brand-maroon"
                />
                <p className="text-xs text-gray-500 mt-2">
                  This appears under the auto-generated label, for example: <span className="font-medium">DSML Assignment 1</span> then <span className="font-medium">Linear Regression Implementation</span>.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  Question PDF {assignmentExperience === 'socratic' ? <span className="text-brand-maroon">(Required for Socratic publish)</span> : <span className="text-gray-400">(Optional)</span>}
                </label>
                <label className="flex items-center justify-between gap-3 border border-gray-300 rounded-lg px-4 py-3 cursor-pointer hover:border-brand-maroon transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <Upload className="w-5 h-5 text-brand-maroon flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {questionFile ? questionFile.name : 'Upload assignment question PDF if you have one'}
                      </p>
                      <p className="text-xs text-gray-500">
                        {questionFile ? formatFileSizeLabel(questionFile.size) : 'PDF only'}
                      </p>
                    </div>
                  </div>
                  <input
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={handleQuestionFileChange}
                  />
                </label>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">Description / Instructions</label>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={6}
                placeholder="Add assignment instructions, submission expectations, grading notes, or any other context students should see."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-brand-maroon resize-none"
              />
            </div>
          </section>

          <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="bg-purple-50 p-3 rounded-xl">
                <Brain className="w-6 h-6 text-purple-700" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Assignment Experience</h2>
                <p className="text-sm text-gray-600">
                  Keep the standard submission flow, or prototype the new Socratic Writing Studio experience.
                </p>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setAssignmentExperience('standard')}
                className={`rounded-2xl border p-5 text-left transition-colors ${
                  assignmentExperience === 'standard'
                    ? 'border-brand-maroon bg-brand-maroon/5'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="inline-flex items-center gap-2 text-base font-semibold text-gray-900">
                  <FileText className="w-5 h-5 text-brand-maroon" />
                  Standard Assignment
                </div>
                <p className="text-sm text-gray-600 mt-2">
                  Students upload files or submit text through the existing assignment workflow.
                </p>
              </button>
              <button
                type="button"
                onClick={() => setAssignmentExperience('socratic')}
                className={`rounded-2xl border p-5 text-left transition-colors ${
                  assignmentExperience === 'socratic'
                    ? 'border-purple-500 bg-purple-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="inline-flex items-center gap-2 text-base font-semibold text-gray-900">
                  <BookOpen className="w-5 h-5 text-purple-700" />
                  Socratic Writing Studio
                </div>
                <p className="text-sm text-gray-600 mt-2">
                  Four-stage guided writing flow with per-stage AI policy, attached resources, a notebook, and ledger.
                </p>
              </button>
            </div>

              {assignmentExperience === 'socratic' && studioBlueprint && (
                <SocraticStudioConfigurator
                  blueprint={studioBlueprint}
                  availableResources={{
                    readings: availableReadings,
                    quizzes: availableQuizzes,
                    avatarLectures: availableAvatarLectures,
                  }}
                  onChange={setStudioBlueprint}
                  onUploadReading={handleUploadSocraticReading}
                  onCreateQuiz={navigateToCreateQuiz}
                  onCreateAvatarLecture={navigateToCreateAvatarLecture}
                  onGenerateStarterResponse={handleGenerateSocraticStarterResponse}
                />
              )}
          </section>

          <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="bg-blue-50 p-3 rounded-xl">
                <Users className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Assigned Students</h2>
                <p className="text-sm text-gray-600">This assignment will automatically be assigned to every student currently enrolled in the selected course.</p>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                <span className="font-medium text-gray-900">Course roster</span>
                <span className="text-sm text-gray-600">{roster.length} students</span>
              </div>
              {roster.length > 0 ? (
                <div className="max-h-64 overflow-y-auto divide-y divide-gray-100">
                  {roster.map((student) => (
                    <div key={student.course_student_id} className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <p className="font-medium text-gray-900">
                          {[student.first_name, student.last_name].filter(Boolean).join(' ') || student.email}
                        </p>
                        <p className="text-sm text-gray-600">{student.email}</p>
                      </div>
                      <span className="text-xs text-gray-500">
                        {student.student_id ? 'Signed up' : 'Invite pending'}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-4 py-8 text-sm text-gray-600 text-center">
                  {selectedCourseId
                    ? 'No students are enrolled in this course yet.'
                    : 'Select a course to preview the roster.'}
                </div>
              )}
            </div>
          </section>

          <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="bg-green-50 p-3 rounded-xl">
                <Upload className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Submission Settings</h2>
                <p className="text-sm text-gray-600">Choose how students can respond and what file formats you will accept.</p>
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">Submission Mode</label>
                <select
                  value={submissionMode}
                  onChange={(event) => setSubmissionMode(event.target.value as AssignmentSubmissionMode)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-brand-maroon"
                >
                  <option value="file_upload">File upload only</option>
                  <option value="text_entry">Text entry only</option>
                  <option value="file_and_text">File upload + text entry</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">Max Files</label>
                <input
                  type="number"
                  min={submissionMode === 'text_entry' ? 0 : 1}
                  value={maxFiles}
                  onChange={(event) => setMaxFiles(event.target.value)}
                  disabled={submissionMode === 'text_entry'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100 focus:ring-2 focus:ring-brand-maroon focus:border-brand-maroon"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">Max File Size (MB)</label>
                <input
                  type="number"
                  min={1}
                  value={maxFileSizeMb}
                  onChange={(event) => setMaxFileSizeMb(event.target.value)}
                  disabled={submissionMode === 'text_entry'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100 focus:ring-2 focus:ring-brand-maroon focus:border-brand-maroon"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">Allowed File Types</label>
              <div className="grid md:grid-cols-3 gap-3">
                {ASSIGNMENT_ALLOWED_FILE_TYPES.map((type) => (
                  <label
                    key={type.mime}
                    className={`flex items-center gap-3 px-3 py-3 rounded-lg border ${
                      allowedMimeTypes.includes(type.mime)
                        ? 'border-brand-maroon bg-brand-maroon/5'
                        : 'border-gray-200'
                    } ${submissionMode === 'text_entry' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <input
                      type="checkbox"
                      checked={allowedMimeTypes.includes(type.mime)}
                      onChange={() => toggleAllowedMimeType(type.mime)}
                      disabled={submissionMode === 'text_entry'}
                      className="rounded border-gray-300 text-brand-maroon focus:ring-brand-maroon"
                    />
                    <span className="text-sm text-gray-900">{type.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </section>

          <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="bg-yellow-50 p-3 rounded-xl">
                <Calendar className="w-6 h-6 text-yellow-600" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Dates & Grading</h2>
                <p className="text-sm text-gray-600">Control the assignment window, late work, and total points.</p>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">Available From</label>
                <input
                  type="datetime-local"
                  value={toDateTimeLocalValue(availableAt)}
                  onChange={(event) => setAvailableAt(event.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-brand-maroon"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">Due Date</label>
                <input
                  type="datetime-local"
                  value={toDateTimeLocalValue(dueAt)}
                  onChange={(event) => setDueAt(event.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-brand-maroon"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">Late Submissions Until</label>
                <input
                  type="datetime-local"
                  value={toDateTimeLocalValue(lateUntil)}
                  onChange={(event) => setLateUntil(event.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-brand-maroon"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">Points Possible</label>
                <input
                  type="number"
                  min={0}
                  value={pointsPossible}
                  onChange={(event) => setPointsPossible(event.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-brand-maroon"
                />
              </div>
            </div>
          </section>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              disabled={savingStatus !== null}
              onClick={(event) => void handleCreateAssignment(event, 'draft')}
              className="border border-gray-300 text-gray-700 font-semibold py-3 px-5 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 inline-flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              {savingStatus === 'draft' ? 'Saving Draft...' : 'Save Draft'}
            </button>
            <button
              type="button"
              disabled={savingStatus !== null}
              onClick={(event) => void handleCreateAssignment(event, 'published')}
              className="bg-brand-maroon hover:bg-brand-maroon-hover text-white font-semibold py-3 px-5 rounded-lg transition-colors disabled:opacity-50 inline-flex items-center gap-2"
            >
              <Send className="w-4 h-4" />
              {savingStatus === 'published' ? 'Publishing...' : 'Publish Assignment'}
            </button>
          </div>
        </form>
      </div>
    </EducatorLayout>
  );
}
