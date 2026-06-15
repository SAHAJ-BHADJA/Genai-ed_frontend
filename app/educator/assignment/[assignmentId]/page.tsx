'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Calendar,
  Download,
  ExternalLink,
  FileText,
  Pencil,
  Save,
  Send,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import EducatorLayout from '@/components/EducatorLayout';
import { getBackendBase } from '@/lib/backend';
import { uploadFile } from '@/lib/fileUpload';
import {
  ASSIGNMENT_ALLOWED_FILE_TYPES,
  AssignmentRecord,
  AssignmentSubmissionFile,
  AssignmentSubmissionMode,
  AssignmentSubmissionRecord,
  formatAssignmentDate,
  formatFileSizeLabel,
  sanitizeFileName,
} from '@/lib/assignments';
import {
  getAssignmentSystemMissingMessage,
  isAssignmentSystemMissingError,
} from '@/lib/assignmentSystemErrors';
import { supabase, Course, Profile } from '@/lib/supabase';
import { fetchSocraticAssignmentConfig } from '@/lib/socraticWritingApi';
import { SOCRATIC_STAGE_ORDER, SocraticStudioBlueprint } from '@/lib/socraticWriting';

type CourseRosterEntry = {
  course_student_id: string;
  student_id: string | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
};

type AssignmentTarget = {
  id: string;
  assignment_id: string;
  course_student_id: string;
  student_id: string | null;
  email: string;
  assigned_at: string;
};

type PromptReadOnlyBlockProps = {
  title: string;
  value?: string | string[] | null;
  emptyLabel?: string;
};

const PromptReadOnlyBlock = ({
  title,
  value,
  emptyLabel = 'Not configured.',
}: PromptReadOnlyBlockProps) => {
  const displayValue = Array.isArray(value) ? value.filter(Boolean).join('\n') : value;
  const normalizedValue = typeof displayValue === 'string' ? displayValue.trim() : '';

  return (
    <div>
      <p className="text-sm font-semibold text-gray-900 mb-2">{title}</p>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm leading-relaxed text-gray-800">
        {normalizedValue || emptyLabel}
      </pre>
    </div>
  );
};

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

export default function EducatorAssignmentDetailPage() {
  const router = useRouter();
  const params = useParams();
  const assignmentId = params.assignmentId as string;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [assignment, setAssignment] = useState<AssignmentRecord | null>(null);
  const [targets, setTargets] = useState<AssignmentTarget[]>([]);
  const [roster, setRoster] = useState<CourseRosterEntry[]>([]);
  const [submissions, setSubmissions] = useState<AssignmentSubmissionRecord[]>([]);
  const [submissionFiles, setSubmissionFiles] = useState<AssignmentSubmissionFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusSaving, setStatusSaving] = useState<string | null>(null);
  const [gradingSubmissionId, setGradingSubmissionId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [savingEdits, setSavingEdits] = useState(false);
  const [gradeDrafts, setGradeDrafts] = useState<Record<string, string>>({});
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, string>>({});
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPointsPossible, setEditPointsPossible] = useState('100');
  const [editSubmissionMode, setEditSubmissionMode] = useState<AssignmentSubmissionMode>('file_upload');
  const [editAllowedMimeTypes, setEditAllowedMimeTypes] = useState<string[]>([]);
  const [editMaxFiles, setEditMaxFiles] = useState('1');
  const [editMaxFileSizeMb, setEditMaxFileSizeMb] = useState('25');
  const [editAvailableAt, setEditAvailableAt] = useState('');
  const [editDueAt, setEditDueAt] = useState('');
  const [editLateUntil, setEditLateUntil] = useState('');
  const [newQuestionFile, setNewQuestionFile] = useState<File | null>(null);
  const [removeQuestionFile, setRemoveQuestionFile] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingAssignment, setDeletingAssignment] = useState(false);
  const [socraticBlueprint, setSocraticBlueprint] = useState<SocraticStudioBlueprint | null>(null);
  const [socraticConfigLoading, setSocraticConfigLoading] = useState(false);
  const [socraticConfigError, setSocraticConfigError] = useState<string | null>(null);

  useEffect(() => {
    void bootstrap();
  }, [assignmentId]);

  const rosterMap = useMemo(
    () => new Map(roster.map((entry) => [entry.course_student_id, entry])),
    [roster],
  );

  const submissionMap = useMemo(
    () => new Map(submissions.map((submission) => [submission.course_student_id, submission])),
    [submissions],
  );

  const submissionFilesMap = useMemo(() => {
    const grouped = new Map<string, AssignmentSubmissionFile[]>();
    submissionFiles.forEach((file) => {
      const current = grouped.get(file.submission_id) || [];
      current.push(file);
      grouped.set(file.submission_id, current);
    });
    return grouped;
  }, [submissionFiles]);

  const analytics = useMemo(() => {
    const totalStudents = targets.length;
    const submittedRows = submissions.filter((submission) => Boolean(submission.submitted_at));
    const gradedRows = submissions.filter((submission) => submission.grade_score !== null);
    const pending = totalStudents - submittedRows.length;
    const avgScore = gradedRows.length > 0
      ? Number(
          (
            gradedRows.reduce((sum, submission) => sum + Number(submission.grade_score || 0), 0)
            / gradedRows.length
          ).toFixed(1),
        )
      : null;

    return {
      totalStudents,
      submitted: submittedRows.length,
      graded: gradedRows.length,
      pending,
      avgScore,
    };
  }, [submissions, targets]);

  const resetEditState = (sourceAssignment: AssignmentRecord) => {
    setEditTitle(sourceAssignment.assignment_title);
    setEditDescription(sourceAssignment.description || '');
    setEditPointsPossible(String(sourceAssignment.points_possible));
    setEditSubmissionMode(sourceAssignment.submission_mode);
    setEditAllowedMimeTypes(sourceAssignment.allowed_mime_types || []);
    setEditMaxFiles(String(sourceAssignment.max_files));
    setEditMaxFileSizeMb(
      sourceAssignment.max_file_size_bytes
        ? String(Math.round(sourceAssignment.max_file_size_bytes / (1024 * 1024)))
        : '25',
    );
    setEditAvailableAt(toDateTimeLocalValue(sourceAssignment.available_at));
    setEditDueAt(toDateTimeLocalValue(sourceAssignment.due_at));
    setEditLateUntil(toDateTimeLocalValue(sourceAssignment.late_until));
    setNewQuestionFile(null);
    setRemoveQuestionFile(false);
  };

  const bootstrap = async () => {
    setLoading(true);

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
      await loadAssignmentData(user.id);
    } catch (error) {
      console.error('Error loading assignment detail:', error);
      toast.error('Failed to load assignment details.');
    } finally {
      setLoading(false);
    }
  };

  const loadAssignmentData = async (educatorId: string) => {
    const { data: assignmentRow, error: assignmentError } = await supabase
      .from('assignments')
      .select('*')
      .eq('id', assignmentId)
      .eq('educator_id', educatorId)
      .maybeSingle();

    if (assignmentError) {
      if (isAssignmentSystemMissingError(assignmentError)) {
        throw new Error(getAssignmentSystemMissingMessage());
      }
      throw assignmentError;
    }

    if (!assignmentRow) {
      router.push('/educator/dashboard');
      return;
    }

    const normalizedAssignment = {
      ...assignmentRow,
      allowed_mime_types: Array.isArray(assignmentRow.allowed_mime_types)
        ? assignmentRow.allowed_mime_types
        : [],
    } as AssignmentRecord;

    setAssignment(normalizedAssignment);
    resetEditState(normalizedAssignment);
    setSocraticBlueprint(null);
    setSocraticConfigError(null);

    if (normalizedAssignment.experience_type === 'socratic_writing') {
      setSocraticConfigLoading(true);
      try {
        const configPayload = await fetchSocraticAssignmentConfig(normalizedAssignment.id);
        setSocraticBlueprint(configPayload.blueprint);
      } catch (error) {
        console.error('Error loading Socratic prompt config:', error);
        setSocraticConfigError(
          error instanceof Error ? error.message : 'Failed to load Socratic prompt configuration.',
        );
      } finally {
        setSocraticConfigLoading(false);
      }
    } else {
      setSocraticConfigLoading(false);
    }

    const [{ data: courseRow }, { data: targetRows, error: targetError }, { data: rosterRows, error: rosterError }, { data: submissionRows, error: submissionError }] = await Promise.all([
      supabase
        .from('courses')
        .select('*')
        .eq('id', normalizedAssignment.course_id)
        .maybeSingle(),
      supabase
        .from('assignment_students')
        .select('*')
        .eq('assignment_id', assignmentId)
        .order('assigned_at', { ascending: true }),
      supabase.rpc('get_course_student_roster', { p_course_id: normalizedAssignment.course_id }),
      supabase
        .from('assignment_submissions')
        .select('*')
        .eq('assignment_id', assignmentId),
    ]);

    if (targetError) throw targetError;
    if (rosterError) throw rosterError;
    if (submissionError) throw submissionError;

    setCourse(courseRow || null);
    setTargets((targetRows || []) as AssignmentTarget[]);
    setRoster((rosterRows || []) as CourseRosterEntry[]);

    const normalizedSubmissions = (submissionRows || []) as AssignmentSubmissionRecord[];
    setSubmissions(normalizedSubmissions);
    setGradeDrafts(
      normalizedSubmissions.reduce<Record<string, string>>((acc, submission) => {
        acc[submission.id] = submission.grade_score?.toString() || '';
        return acc;
      }, {}),
    );
    setFeedbackDrafts(
      normalizedSubmissions.reduce<Record<string, string>>((acc, submission) => {
        acc[submission.id] = submission.feedback_text || '';
        return acc;
      }, {}),
    );

    if (normalizedSubmissions.length > 0) {
      const submissionIds = normalizedSubmissions.map((submission) => submission.id);
      const { data: fileRows, error: fileError } = await supabase
        .from('assignment_submission_files')
        .select('*')
        .in('submission_id', submissionIds)
        .order('created_at', { ascending: true });

      if (fileError) throw fileError;

      setSubmissionFiles((fileRows || []) as AssignmentSubmissionFile[]);
    } else {
      setSubmissionFiles([]);
    }
  };

  const handleAssignmentStatusChange = async (nextStatus: 'published' | 'closed') => {
    if (!assignment) return;

    setStatusSaving(nextStatus);

    try {
      const { error } = await supabase
        .from('assignments')
        .update({
          status: nextStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', assignment.id);

      if (error) throw error;

      setAssignment({
        ...assignment,
        status: nextStatus,
        updated_at: new Date().toISOString(),
      });
      toast.success(nextStatus === 'published' ? 'Assignment published.' : 'Assignment closed.');
    } catch (error) {
      console.error('Error updating assignment status:', error);
      toast.error('Failed to update assignment status.');
    } finally {
      setStatusSaving(null);
    }
  };

  const toggleAllowedMimeType = (mime: string) => {
    setEditAllowedMimeTypes((current) =>
      current.includes(mime)
        ? current.filter((value) => value !== mime)
        : [...current, mime],
    );
  };

  const handleQuestionFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;

    if (!file) {
      setNewQuestionFile(null);
      return;
    }

    if (file.type !== 'application/pdf') {
      toast.error('Assignment questions must be uploaded as a PDF.');
      event.target.value = '';
      return;
    }

    setNewQuestionFile(file);
    setRemoveQuestionFile(false);
  };

  const handleCancelEdit = () => {
    if (!assignment) return;
    resetEditState(assignment);
    setIsEditing(false);
  };

  const handleSaveAssignmentEdits = async () => {
    if (!assignment) return;

    if (!editTitle.trim()) {
      toast.error('Add an assignment title.');
      return;
    }

    if (!editDueAt) {
      toast.error('Set a due date before saving.');
      return;
    }

    if (
      (editSubmissionMode === 'file_upload' || editSubmissionMode === 'file_and_text')
      && editAllowedMimeTypes.length === 0
    ) {
      toast.error('Pick at least one allowed submission file type.');
      return;
    }

    const availableAtIso = fromDateTimeLocalValue(editAvailableAt);
    const dueAtIso = fromDateTimeLocalValue(editDueAt);
    const lateUntilIso = fromDateTimeLocalValue(editLateUntil);

    if (availableAtIso && dueAtIso && new Date(dueAtIso) < new Date(availableAtIso)) {
      toast.error('Due date must be after the availability date.');
      return;
    }

    if (lateUntilIso && dueAtIso && new Date(lateUntilIso) < new Date(dueAtIso)) {
      toast.error('Late submission deadline must be after the due date.');
      return;
    }

    setSavingEdits(true);

    let uploadedPath: string | null = null;

    try {
      let questionFileName = assignment.question_file_name;
      let questionPdfUrl = assignment.question_pdf_url;
      let questionStoragePath = assignment.question_storage_path;

      if (newQuestionFile) {
        const nextStoragePath = `assignment-questions/${assignment.id}/${Date.now()}-${sanitizeFileName(newQuestionFile.name)}`;
        const uploadResult = await uploadFile(newQuestionFile, nextStoragePath, 'assignment-files');

        if (uploadResult.error || !uploadResult.url) {
          throw new Error(uploadResult.error || 'Failed to upload assignment question PDF.');
        }

        uploadedPath = nextStoragePath;
        questionFileName = newQuestionFile.name;
        questionPdfUrl = uploadResult.url;
        questionStoragePath = nextStoragePath;
      } else if (removeQuestionFile) {
        questionFileName = null;
        questionPdfUrl = null;
        questionStoragePath = null;
      }

      const updatedAt = new Date().toISOString();
      const updatePayload = {
        assignment_title: editTitle.trim(),
        description: editDescription.trim() || null,
        points_possible: Number(editPointsPossible) || 0,
        submission_mode: editSubmissionMode,
        allowed_mime_types: editSubmissionMode === 'text_entry' ? [] : editAllowedMimeTypes,
        max_file_size_bytes:
          editSubmissionMode === 'text_entry'
            ? null
            : (Number(editMaxFileSizeMb) || 0) * 1024 * 1024,
        max_files: editSubmissionMode === 'text_entry' ? 0 : Number(editMaxFiles) || 1,
        available_at: availableAtIso,
        due_at: dueAtIso,
        late_until: lateUntilIso,
        question_file_name: questionFileName,
        question_pdf_url: questionPdfUrl,
        question_storage_path: questionStoragePath,
        updated_at: updatedAt,
      };

      const { error } = await supabase
        .from('assignments')
        .update(updatePayload)
        .eq('id', assignment.id);

      if (error) throw error;

      if (
        assignment.question_storage_path
        && (removeQuestionFile || Boolean(newQuestionFile))
        && assignment.question_storage_path !== questionStoragePath
      ) {
        await supabase.storage.from('assignment-files').remove([assignment.question_storage_path]);
      }

      const updatedAssignment: AssignmentRecord = {
        ...assignment,
        ...updatePayload,
        allowed_mime_types: updatePayload.allowed_mime_types,
      };

      setAssignment(updatedAssignment);
      resetEditState(updatedAssignment);
      setIsEditing(false);
      toast.success('Assignment updated.');
    } catch (error) {
      console.error('Error updating assignment:', error);

      if (uploadedPath) {
        await supabase.storage.from('assignment-files').remove([uploadedPath]);
      }

      toast.error(error instanceof Error ? error.message : 'Failed to update assignment.');
    } finally {
      setSavingEdits(false);
    }
  };

  const handleSaveGrade = async (submission: AssignmentSubmissionRecord) => {
    const gradeValue = gradeDrafts[submission.id];
    const feedbackValue = feedbackDrafts[submission.id];

    if (!profile) return;

    setGradingSubmissionId(submission.id);

    try {
      const normalizedGrade = gradeValue.trim() === '' ? null : Number(gradeValue);

      if (normalizedGrade !== null && Number.isNaN(normalizedGrade)) {
        throw new Error('Grade must be a valid number.');
      }

      const { error } = await supabase
        .from('assignment_submissions')
        .update({
          grade_score: normalizedGrade,
          feedback_text: feedbackValue.trim() || null,
          feedback_returned_at: new Date().toISOString(),
          grader_id: profile.id,
          status: normalizedGrade !== null ? 'graded' : submission.status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', submission.id);

      if (error) throw error;

      setSubmissions((current) =>
        current.map((entry) =>
          entry.id === submission.id
            ? {
                ...entry,
                grade_score: normalizedGrade,
                feedback_text: feedbackValue.trim() || null,
                feedback_returned_at: new Date().toISOString(),
                status: normalizedGrade !== null ? 'graded' : entry.status,
                updated_at: new Date().toISOString(),
                grader_id: profile.id,
              }
            : entry,
        ),
      );

      toast.success('Grade and feedback saved.');
    } catch (error) {
      console.error('Error saving grade:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to save grade.');
    } finally {
      setGradingSubmissionId(null);
    }
  };

  const handleDeleteAssignment = async () => {
    if (!assignment) return;

    setDeletingAssignment(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error('Your session expired. Please sign in again.');
      }

      const backendBase = getBackendBase();
      if (!backendBase) {
        throw new Error('Backend base URL is not configured.');
      }

      const response = await fetch(`${backendBase}/api/assignments/${assignment.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        const raw = await response.text();
        let detail = raw;
        try {
          const parsed = JSON.parse(raw) as { detail?: string };
          detail = parsed.detail || raw;
        } catch {
          // Keep raw response text when it is not JSON.
        }
        throw new Error(detail || 'Failed to delete assignment.');
      }

      toast.success('Assignment deleted completely.');
      router.push(course ? `/educator/course/${course.id}` : '/educator/dashboard');
    } catch (error) {
      console.error('Error deleting assignment:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to delete assignment.');
    } finally {
      setDeletingAssignment(false);
      setShowDeleteModal(false);
    }
  };

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!assignment) {
    return null;
  }

  return (
    <EducatorLayout profile={profile}>
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <button
              onClick={() => router.push(course ? `/educator/course/${course.id}` : '/educator/dashboard')}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors mb-4"
            >
              <ArrowLeft className="w-5 h-5" />
              Back to Course
            </button>
            <h1 className="text-3xl font-bold text-gray-900">{assignment.assignment_label}</h1>
            <p className="text-gray-700 mt-1">{assignment.assignment_title}</p>
            <p className="text-sm text-gray-500 mt-2">
              {course ? `${course.course_number ? `${course.course_number} - ` : ''}${course.title}` : 'Course unavailable'}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            {assignment.experience_type === 'socratic_writing' && (
              <button
                onClick={() => router.push(`/educator/assignment/${assignment.id}/socratic-review`)}
                className="border border-purple-300 text-purple-700 font-semibold py-3 px-5 rounded-lg hover:bg-purple-50 transition-colors inline-flex items-center gap-2"
              >
                <BookOpen className="w-4 h-4" />
                Socratic Review
              </button>
            )}
            <button
              onClick={() => {
                if (!assignment) return;
                if (isEditing) {
                  handleCancelEdit();
                  return;
                }
                resetEditState(assignment);
                setIsEditing(true);
              }}
              disabled={savingEdits}
              className="border border-gray-300 text-gray-700 font-semibold py-3 px-5 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 inline-flex items-center gap-2"
            >
              {isEditing ? <X className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
              {isEditing ? 'Cancel Edit' : 'Edit Assignment'}
            </button>
            {assignment.status !== 'published' && (
              <button
                onClick={() => void handleAssignmentStatusChange('published')}
                disabled={statusSaving !== null || savingEdits}
                className="bg-brand-maroon hover:bg-brand-maroon-hover text-white font-semibold py-3 px-5 rounded-lg transition-colors disabled:opacity-50 inline-flex items-center gap-2"
              >
                <Send className="w-4 h-4" />
                {statusSaving === 'published' ? 'Publishing...' : 'Publish'}
              </button>
            )}
            {assignment.status !== 'closed' && (
              <button
                onClick={() => void handleAssignmentStatusChange('closed')}
                disabled={statusSaving !== null || savingEdits}
                className="border border-gray-300 text-gray-700 font-semibold py-3 px-5 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 inline-flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                {statusSaving === 'closed' ? 'Closing...' : 'Close Assignment'}
              </button>
            )}
            <button
              onClick={() => setShowDeleteModal(true)}
              disabled={savingEdits || deletingAssignment}
              className="border border-red-300 text-red-700 font-semibold py-3 px-5 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50 inline-flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              {deletingAssignment ? 'Deleting...' : 'Delete Assignment'}
            </button>
          </div>
        </div>

        <section className="grid lg:grid-cols-[2fr,1fr] gap-6">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="bg-brand-maroon/10 p-3 rounded-xl">
                <FileText className="w-6 h-6 text-brand-maroon" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Assignment Details</h2>
                <p className="text-sm text-gray-600">Question file, instructions, and schedule.</p>
              </div>
            </div>

            {isEditing ? (
              <div className="space-y-5">
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-2">Assignment Label</label>
                    <div className="rounded-xl border border-dashed border-brand-maroon/30 bg-brand-maroon/5 px-4 py-3 text-sm font-semibold text-brand-maroon">
                      {assignment.assignment_label}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-2">Assignment Title</label>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(event) => setEditTitle(event.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-brand-maroon"
                    />
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-2">Points Possible</label>
                    <input
                      type="number"
                      min={0}
                      value={editPointsPossible}
                      onChange={(event) => setEditPointsPossible(event.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-brand-maroon"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-2">Submission Mode</label>
                    <select
                      value={editSubmissionMode}
                      onChange={(event) => setEditSubmissionMode(event.target.value as AssignmentSubmissionMode)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-brand-maroon"
                    >
                      <option value="file_upload">File upload only</option>
                      <option value="text_entry">Text entry only</option>
                      <option value="file_and_text">File upload + text entry</option>
                    </select>
                  </div>
                </div>

                <div className="grid md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-2">Available From</label>
                    <input
                      type="datetime-local"
                      value={editAvailableAt}
                      onChange={(event) => setEditAvailableAt(event.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-brand-maroon"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-2">Due Date</label>
                    <input
                      type="datetime-local"
                      value={editDueAt}
                      onChange={(event) => setEditDueAt(event.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-brand-maroon"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-2">Late Until</label>
                    <input
                      type="datetime-local"
                      value={editLateUntil}
                      onChange={(event) => setEditLateUntil(event.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-brand-maroon"
                    />
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-2">Max Files</label>
                    <input
                      type="number"
                      min={editSubmissionMode === 'text_entry' ? 0 : 1}
                      value={editMaxFiles}
                      onChange={(event) => setEditMaxFiles(event.target.value)}
                      disabled={editSubmissionMode === 'text_entry'}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100 focus:ring-2 focus:ring-brand-maroon focus:border-brand-maroon"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-2">Max File Size (MB)</label>
                    <input
                      type="number"
                      min={1}
                      value={editMaxFileSizeMb}
                      onChange={(event) => setEditMaxFileSizeMb(event.target.value)}
                      disabled={editSubmissionMode === 'text_entry'}
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
                          editAllowedMimeTypes.includes(type.mime)
                            ? 'border-brand-maroon bg-brand-maroon/5'
                            : 'border-gray-200'
                        } ${editSubmissionMode === 'text_entry' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                      >
                        <input
                          type="checkbox"
                          checked={editAllowedMimeTypes.includes(type.mime)}
                          onChange={() => toggleAllowedMimeType(type.mime)}
                          disabled={editSubmissionMode === 'text_entry'}
                          className="rounded border-gray-300 text-brand-maroon focus:ring-brand-maroon"
                        />
                        <span className="text-sm text-gray-900">{type.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">Instructions</label>
                  <textarea
                    rows={6}
                    value={editDescription}
                    onChange={(event) => setEditDescription(event.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-brand-maroon resize-none"
                  />
                </div>

                <div className="space-y-3">
                  <label className="block text-sm font-medium text-gray-900">Question PDF</label>
                  <label className="flex items-center justify-between gap-3 border border-gray-300 rounded-lg px-4 py-3 cursor-pointer hover:border-brand-maroon transition-colors">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {newQuestionFile
                          ? newQuestionFile.name
                          : assignment.question_file_name || 'Upload a new assignment question PDF'}
                      </p>
                      <p className="text-xs text-gray-500">
                        {newQuestionFile
                          ? formatFileSizeLabel(newQuestionFile.size)
                          : assignment.question_file_name
                          ? 'Current assignment PDF'
                          : 'PDF only'}
                      </p>
                    </div>
                    <input
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      onChange={handleQuestionFileChange}
                    />
                  </label>

                  {(assignment.question_pdf_url || newQuestionFile) && (
                    <div className="flex flex-wrap gap-3">
                      {!removeQuestionFile && (assignment.question_pdf_url || newQuestionFile) && (
                        <button
                          type="button"
                          onClick={() => {
                            setRemoveQuestionFile(true);
                            setNewQuestionFile(null);
                          }}
                          className="border border-red-300 text-red-700 px-4 py-2 rounded-lg hover:bg-red-50 transition-colors"
                        >
                          Remove Question PDF
                        </button>
                      )}
                      {removeQuestionFile && (
                        <button
                          type="button"
                          onClick={() => setRemoveQuestionFile(false)}
                          className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
                        >
                          Keep Existing PDF
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    disabled={savingEdits}
                    className="border border-gray-300 text-gray-700 font-semibold py-3 px-5 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveAssignmentEdits()}
                    disabled={savingEdits}
                    className="bg-brand-maroon hover:bg-brand-maroon-hover text-white font-semibold py-3 px-5 rounded-lg transition-colors disabled:opacity-50 inline-flex items-center gap-2"
                  >
                    <Save className="w-4 h-4" />
                    {savingEdits ? 'Saving Changes...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="grid md:grid-cols-2 gap-4 text-sm">
                  <div className="rounded-xl bg-gray-50 p-4">
                    <p className="text-gray-500 mb-1">Status</p>
                    <p className="font-semibold text-gray-900 capitalize">{assignment.status}</p>
                  </div>
                  <div className="rounded-xl bg-gray-50 p-4">
                    <p className="text-gray-500 mb-1">Points Possible</p>
                    <p className="font-semibold text-gray-900">{assignment.points_possible}</p>
                  </div>
                  <div className="rounded-xl bg-gray-50 p-4">
                    <p className="text-gray-500 mb-1">Available From</p>
                    <p className="font-semibold text-gray-900">{formatAssignmentDate(assignment.available_at)}</p>
                  </div>
                  <div className="rounded-xl bg-gray-50 p-4">
                    <p className="text-gray-500 mb-1">Due Date</p>
                    <p className="font-semibold text-gray-900">{formatAssignmentDate(assignment.due_at)}</p>
                  </div>
                  <div className="rounded-xl bg-gray-50 p-4">
                    <p className="text-gray-500 mb-1">Late Until</p>
                    <p className="font-semibold text-gray-900">{formatAssignmentDate(assignment.late_until)}</p>
                  </div>
                  <div className="rounded-xl bg-gray-50 p-4">
                    <p className="text-gray-500 mb-1">Submission Mode</p>
                    <p className="font-semibold text-gray-900">{assignment.submission_mode.replaceAll('_', ' ')}</p>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold text-gray-900 mb-2">Instructions</h3>
                  <div className="rounded-xl border border-gray-200 p-4 text-sm text-gray-700 whitespace-pre-wrap min-h-[120px]">
                    {assignment.description || 'No instructions provided.'}
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  {assignment.question_pdf_url && (
                    <button
                      onClick={() => window.open(assignment.question_pdf_url!, '_blank', 'noopener,noreferrer')}
                      className="inline-flex items-center gap-2 border border-brand-maroon text-brand-maroon px-4 py-2 rounded-lg hover:bg-brand-maroon hover:text-white transition-colors"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Open Question PDF
                    </button>
                  )}
                  {assignment.question_pdf_url && (
                    <a
                      href={assignment.question_pdf_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      Download PDF
                    </a>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="bg-blue-50 p-3 rounded-xl">
                <Users className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Submission Summary</h2>
                <p className="text-sm text-gray-600">Roster-wide assignment progress.</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-gray-50 p-4">
                <p className="text-xs text-gray-500 mb-1">Assigned Students</p>
                <p className="text-2xl font-bold text-gray-900">{analytics.totalStudents}</p>
              </div>
              <div className="rounded-xl bg-gray-50 p-4">
                <p className="text-xs text-gray-500 mb-1">Submitted</p>
                <p className="text-2xl font-bold text-green-600">{analytics.submitted}</p>
              </div>
              <div className="rounded-xl bg-gray-50 p-4">
                <p className="text-xs text-gray-500 mb-1">Graded</p>
                <p className="text-2xl font-bold text-blue-600">{analytics.graded}</p>
              </div>
              <div className="rounded-xl bg-gray-50 p-4">
                <p className="text-xs text-gray-500 mb-1">Pending</p>
                <p className="text-2xl font-bold text-orange-600">{analytics.pending}</p>
              </div>
            </div>

            <div className="rounded-xl bg-gray-50 p-4">
              <p className="text-xs text-gray-500 mb-1">Average Grade</p>
              <p className="text-2xl font-bold text-purple-600">
                {analytics.avgScore !== null ? `${analytics.avgScore}` : '--'}
              </p>
            </div>
          </div>
        </section>

        {assignment.experience_type === 'socratic_writing' && (
          <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="bg-purple-50 p-3 rounded-xl">
                  <BookOpen className="w-6 h-6 text-purple-700" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">Socratic Prompt Configuration</h2>
                  <p className="text-sm text-gray-600">
                    View-only snapshot of the prompts saved for this assignment.
                  </p>
                </div>
              </div>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">
                Read only
              </span>
            </div>

            {socraticConfigLoading && (
              <div className="rounded-xl border border-dashed border-gray-300 p-6 text-sm text-gray-600">
                Loading saved Socratic prompts...
              </div>
            )}

            {socraticConfigError && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {socraticConfigError}
              </div>
            )}

            {!socraticConfigLoading && !socraticConfigError && socraticBlueprint && (
              <>
                {(() => {
                  const promptControls = socraticBlueprint.promptControls || {};
                  return (
                    <>
                <div className="grid md:grid-cols-2 gap-4 text-sm">
                  <div className="rounded-xl bg-gray-50 p-4">
                    <p className="text-gray-500 mb-1">Model</p>
                    <p className="font-semibold text-gray-900">{socraticBlueprint.model}</p>
                  </div>
                  <div className="rounded-xl bg-gray-50 p-4">
                    <p className="text-gray-500 mb-1">Resources Attached</p>
                    <p className="font-semibold text-gray-900">{socraticBlueprint.resources.length}</p>
                  </div>
                </div>

                <details className="rounded-2xl border border-gray-200 bg-white p-4" open>
                  <summary className="cursor-pointer text-base font-semibold text-gray-900">
                    Assignment-Level Prompt Controls
                  </summary>
                  <div className="mt-4 grid lg:grid-cols-2 gap-4">
                    <PromptReadOnlyBlock
                      title="Global Runtime Prompt"
                      value={promptControls.globalPrompt}
                    />
                    <PromptReadOnlyBlock
                      title="Chat Response Instructions"
                      value={promptControls.chatResponseInstructions}
                    />
                    <PromptReadOnlyBlock
                      title="Readiness Generation System Prompt"
                      value={promptControls.readinessGenerationSystemPrompt}
                    />
                    <PromptReadOnlyBlock
                      title="Readiness Generation User Prompt"
                      value={promptControls.readinessGenerationUserPrompt}
                    />
                    <div className="lg:col-span-2">
                      <PromptReadOnlyBlock
                        title="Starter Response Instructions"
                        value={promptControls.starterResponseInstructions}
                      />
                    </div>
                  </div>
                </details>
                    </>
                  );
                })()}

                <div className="space-y-4">
                  {SOCRATIC_STAGE_ORDER.map((stageKey) => {
                    const stage = socraticBlueprint.stages[stageKey];
                    if (!stage) return null;
                    const readinessQuestions = Array.isArray(stage.readinessQuestions) ? stage.readinessQuestions : [];
                    const starterQuestions = Array.isArray(stage.starterQuestions) ? stage.starterQuestions : [];

                    return (
                      <details key={stageKey} className="rounded-2xl border border-gray-200 bg-white p-4">
                        <summary className="cursor-pointer">
                          <span className="text-base font-semibold text-gray-900">{stage.label}</span>
                          <span className="ml-3 text-sm text-gray-500">{stage.summary}</span>
                        </summary>

                        <div className="mt-4 space-y-4">
                          <div className="grid md:grid-cols-3 gap-3 text-sm">
                            <div className="rounded-xl bg-gray-50 p-3">
                              <p className="text-gray-500 mb-1">AI Chat</p>
                              <p className="font-semibold text-gray-900">{stage.aiAllowed ? 'Enabled' : 'Disabled'}</p>
                            </div>
                            <div className="rounded-xl bg-gray-50 p-3">
                              <p className="text-gray-500 mb-1">Hidden Readiness Goals</p>
                              <p className="font-semibold text-gray-900">{readinessQuestions.length}</p>
                            </div>
                            <div className="rounded-xl bg-gray-50 p-3">
                              <p className="text-gray-500 mb-1">Starter Questions</p>
                              <p className="font-semibold text-gray-900">{starterQuestions.length}</p>
                            </div>
                          </div>

                          <div className="grid lg:grid-cols-2 gap-4">
                            <PromptReadOnlyBlock title="Stage Runtime Chat Prompt" value={stage.systemPrompt} />
                            <PromptReadOnlyBlock title="Stage Starter Generation Prompt" value={stage.starterPrompt} />
                            <PromptReadOnlyBlock title="Stage Readiness Question Generation Prompt" value={stage.readinessPrompt} />
                            <PromptReadOnlyBlock title="Assignment-Specific Stage Instructions" value={stage.customInstructions} />
                            <PromptReadOnlyBlock title="Hidden Readiness Goals" value={readinessQuestions} />
                            <PromptReadOnlyBlock title="Starter Questions" value={starterQuestions} />
                            <div className="lg:col-span-2">
                              <PromptReadOnlyBlock title="Student Starter Response" value={stage.starterResponse} />
                            </div>
                          </div>
                        </div>
                      </details>
                    );
                  })}
                </div>
              </>
            )}

            {!socraticConfigLoading && !socraticConfigError && !socraticBlueprint && (
              <div className="rounded-xl border border-dashed border-gray-300 p-6 text-sm text-gray-600">
                No Socratic prompt configuration was found for this assignment.
              </div>
            )}
          </section>
        )}

        <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="bg-green-50 p-3 rounded-xl">
              <Calendar className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Student Submissions</h2>
              <p className="text-sm text-gray-600">Review each assigned student, open their files, and save grades and feedback.</p>
            </div>
          </div>

          <div className="space-y-4">
            {targets.map((target) => {
              const rosterEntry = rosterMap.get(target.course_student_id);
              const submission = submissionMap.get(target.course_student_id);
              const files = submission ? submissionFilesMap.get(submission.id) || [] : [];
              const studentName = rosterEntry
                ? [rosterEntry.first_name, rosterEntry.last_name].filter(Boolean).join(' ')
                : '';

              return (
                <div key={target.id} className="rounded-2xl border border-gray-200 p-5 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">
                        {studentName || target.email}
                      </h3>
                      <p className="text-sm text-gray-600">{target.email}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {submission?.submitted_at
                          ? `Submitted ${formatAssignmentDate(submission.submitted_at)}${submission.is_late ? ' (late)' : ''}`
                          : 'No submission yet'}
                      </p>
                    </div>
                    <div className="text-sm text-right">
                      <p className="text-gray-500">Current Status</p>
                      <p className="font-semibold text-gray-900 capitalize">{submission?.status || 'pending'}</p>
                    </div>
                  </div>

                  {files.length > 0 && (
                    <div>
                      <h4 className="font-medium text-gray-900 mb-2">Submitted Files</h4>
                      <div className="space-y-2">
                        {files.map((file) => (
                          <div
                            key={file.id}
                            className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3"
                          >
                            <div>
                              <p className="font-medium text-gray-900">{file.file_name}</p>
                              <p className="text-xs text-gray-500">{file.file_mime || 'Unknown type'}</p>
                            </div>
                            <button
                              onClick={() => window.open(file.file_url, '_blank', 'noopener,noreferrer')}
                              className="inline-flex items-center gap-2 border border-gray-300 text-gray-700 px-3 py-2 rounded-lg hover:bg-white transition-colors"
                            >
                              <Download className="w-4 h-4" />
                              Open
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {submission?.submission_text && (
                    <div>
                      <h4 className="font-medium text-gray-900 mb-2">Submission Notes</h4>
                      <div className="rounded-xl border border-gray-200 p-4 text-sm text-gray-700 whitespace-pre-wrap">
                        {submission.submission_text}
                      </div>
                    </div>
                  )}

                  {submission ? (
                    <div className="grid lg:grid-cols-[220px,1fr,140px] gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-900 mb-2">Grade</label>
                        <input
                          type="number"
                          min={0}
                          step="0.1"
                          value={gradeDrafts[submission.id] || ''}
                          onChange={(event) =>
                            setGradeDrafts((current) => ({
                              ...current,
                              [submission.id]: event.target.value,
                            }))
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-brand-maroon"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-900 mb-2">Feedback</label>
                        <textarea
                          rows={4}
                          value={feedbackDrafts[submission.id] || ''}
                          onChange={(event) =>
                            setFeedbackDrafts((current) => ({
                              ...current,
                              [submission.id]: event.target.value,
                            }))
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-brand-maroon resize-none"
                          placeholder="Add grading feedback for the student."
                        />
                      </div>

                      <div className="flex items-end">
                        <button
                          onClick={() => void handleSaveGrade(submission)}
                          disabled={gradingSubmissionId === submission.id}
                          className="w-full bg-brand-maroon hover:bg-brand-maroon-hover text-white font-semibold py-3 px-4 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {gradingSubmissionId === submission.id ? 'Saving...' : 'Save Grade'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl bg-yellow-50 border border-yellow-200 px-4 py-3 text-sm text-yellow-800">
                      This student has not submitted anything yet.
                    </div>
                  )}
                </div>
              );
            })}

            {targets.length === 0 && (
              <div className="rounded-2xl border border-dashed border-gray-300 p-10 text-center text-gray-600">
                No students are assigned to this assignment.
              </div>
            )}
          </div>
        </section>
      </div>

      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-gray-200 p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-red-50 p-3">
                <AlertTriangle className="h-6 w-6 text-red-600" />
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-semibold text-gray-900">Delete assignment?</h2>
                <p className="text-sm text-gray-700">
                  This will permanently delete the assignment, student submissions, attached question PDF,
                  assignment-owned Socratic uploads, and related database records.
                </p>
                <p className="text-sm font-medium text-red-700">
                  This action cannot be undone.
                </p>
              </div>
            </div>

            <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 text-sm text-gray-700">
              <p className="font-semibold text-gray-900">{assignment.assignment_label}</p>
              <p>{assignment.assignment_title}</p>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                disabled={deletingAssignment}
                className="border border-gray-300 text-gray-700 font-semibold py-3 px-5 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteAssignment()}
                disabled={deletingAssignment}
                className="bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-5 rounded-lg transition-colors disabled:opacity-50 inline-flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                {deletingAssignment ? 'Deleting...' : 'Yes, Delete Assignment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </EducatorLayout>
  );
}
