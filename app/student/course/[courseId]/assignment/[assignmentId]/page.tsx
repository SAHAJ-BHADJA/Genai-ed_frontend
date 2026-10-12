'use client';

import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  BookOpen,
  Calendar,
  Download,
  ExternalLink,
  FileText,
  Save,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import StudentLayout from '@/components/StudentLayout';
import { supabase, Profile } from '@/lib/supabase';
import { hasProfileRole } from '@/lib/profileRoles';
import { uploadFile } from '@/lib/fileUpload';
import {
  getAssignmentSystemMissingMessage,
  isAssignmentSystemMissingError,
} from '@/lib/assignmentSystemErrors';
import {
  AssignmentSubmissionFile,
  canSubmitAssignment,
  formatAssignmentDate,
  formatFileSizeLabel,
  sanitizeFileName,
  StudentCourseAssignment,
} from '@/lib/assignments';

type CourseSummary = {
  id: string;
  course_number: string;
  title: string;
  instructor_name: string;
  semester: string;
};

type EnrollmentRow = {
  id: string;
  email: string;
  student_id: string | null;
};

export default function StudentAssignmentDetailPage() {
  const router = useRouter();
  const params = useParams();
  const courseId = params.courseId as string;
  const assignmentId = params.assignmentId as string;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [course, setCourse] = useState<CourseSummary | null>(null);
  const [assignment, setAssignment] = useState<StudentCourseAssignment | null>(null);
  const [enrollment, setEnrollment] = useState<EnrollmentRow | null>(null);
  const [existingFiles, setExistingFiles] = useState<AssignmentSubmissionFile[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [submissionText, setSubmissionText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void bootstrap();
  }, [assignmentId, courseId]);

  const canSubmit = assignment ? canSubmitAssignment(assignment) : false;
  const fileUploadsEnabled = assignment
    ? assignment.submission_mode === 'file_upload' || assignment.submission_mode === 'file_and_text'
    : false;
  const textEntryEnabled = assignment
    ? assignment.submission_mode === 'text_entry' || assignment.submission_mode === 'file_and_text'
    : false;

  const pendingFilesLabel = useMemo(() => {
    if (selectedFiles.length === 0) return 'No new files selected';
    return `${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'} ready to upload`;
  }, [selectedFiles.length]);

  const bootstrap = async () => {
    setLoading(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

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
        router.push('/student/login');
        return;
      }

      setProfile(profileData);

      const [{ data: enrollmentRow }, { data: courseRow }, { data: assignmentRows, error: assignmentError }] = await Promise.all([
        supabase
          .from('course_students')
          .select('id, email, student_id')
          .eq('course_id', courseId)
          .or(`student_id.eq.${user.id},email.eq.${profileData.email}`)
          .maybeSingle(),
        supabase
          .from('courses')
          .select('id, course_number, title, instructor_name, semester')
          .eq('id', courseId)
          .maybeSingle(),
        supabase.rpc('get_student_course_assignments', { p_course_id: courseId }),
      ]);

      if (!enrollmentRow) {
        router.push('/student/dashboard');
        return;
      }

      if (assignmentError) {
        if (isAssignmentSystemMissingError(assignmentError)) {
          throw new Error(getAssignmentSystemMissingMessage());
        }
        throw assignmentError;
      }

      const matchingAssignment = ((assignmentRows || []) as any[]).find(
        (row) => row.id === assignmentId,
      );

      if (!matchingAssignment) {
        router.push(`/student/course/${courseId}`);
        return;
      }

      const normalizedAssignment = {
        ...matchingAssignment,
        allowed_mime_types: Array.isArray(matchingAssignment.allowed_mime_types)
          ? matchingAssignment.allowed_mime_types
          : [],
      } as StudentCourseAssignment;

      const { data: assignmentMetaRow, error: assignmentMetaError } = await supabase
        .from('assignments')
        .select('experience_type')
        .eq('id', assignmentId)
        .maybeSingle();

      if (assignmentMetaError) {
        throw assignmentMetaError;
      }

      setCourse((courseRow || null) as CourseSummary | null);
      setEnrollment(enrollmentRow as EnrollmentRow);
      setAssignment({
        ...normalizedAssignment,
        experience_type: assignmentMetaRow?.experience_type || 'standard',
      });
      setSubmissionText(normalizedAssignment.submission_text || '');

      if (normalizedAssignment.submission_id) {
        const { data: fileRows, error: fileError } = await supabase
          .from('assignment_submission_files')
          .select('*')
          .eq('submission_id', normalizedAssignment.submission_id)
          .order('created_at', { ascending: true });

        if (fileError) throw fileError;
        setExistingFiles((fileRows || []) as AssignmentSubmissionFile[]);
      } else {
        setExistingFiles([]);
      }
    } catch (error) {
      console.error('Error loading assignment detail:', error);
      toast.error('Failed to load assignment.');
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);

    if (!assignment) return;

    if (files.length > assignment.max_files) {
      toast.error(`You can upload up to ${assignment.max_files} file(s) for this assignment.`);
      event.target.value = '';
      return;
    }

    const invalidType = files.find((file) =>
      assignment.allowed_mime_types.length > 0
      && !assignment.allowed_mime_types.includes(file.type),
    );

    if (invalidType) {
      toast.error(`${invalidType.name} is not an allowed file type for this assignment.`);
      event.target.value = '';
      return;
    }

    const invalidSize = files.find((file) =>
      assignment.max_file_size_bytes
      && file.size > assignment.max_file_size_bytes,
    );

    if (invalidSize) {
      toast.error(`${invalidSize.name} exceeds the file size limit.`);
      event.target.value = '';
      return;
    }

    setSelectedFiles(files);
  };

  const handleSubmit = async () => {
    if (!assignment || !enrollment || !profile) return;

    const textValue = submissionText.trim();
    const hasExistingFiles = existingFiles.length > 0;
    const hasNewFiles = selectedFiles.length > 0;

    if (!canSubmit) {
      toast.error('This assignment is no longer accepting submissions.');
      return;
    }

    if (fileUploadsEnabled && !hasExistingFiles && !hasNewFiles && !textEntryEnabled) {
      toast.error('Upload at least one file before submitting.');
      return;
    }

    if (textEntryEnabled && !fileUploadsEnabled && !textValue) {
      toast.error('Enter your submission text before submitting.');
      return;
    }

    if (textEntryEnabled && fileUploadsEnabled && !textValue && !hasExistingFiles && !hasNewFiles) {
      toast.error('Add text, upload files, or both before submitting.');
      return;
    }

    setSaving(true);

    try {
      const submittedAt = new Date().toISOString();
      const isLate = assignment.due_at ? new Date(assignment.due_at) < new Date(submittedAt) : false;

      const { data: submissionRow, error: submissionError } = await supabase
        .from('assignment_submissions')
        .upsert(
          {
            assignment_id: assignment.id,
            course_student_id: enrollment.id,
            student_id: profile.id,
            submission_text: textEntryEnabled ? textValue || null : null,
            submitted_at: submittedAt,
            updated_at: submittedAt,
            is_late: isLate,
            status: isLate ? 'late' : 'submitted',
          },
          { onConflict: 'assignment_id,course_student_id' },
        )
        .select()
        .single();

      if (submissionError) throw submissionError;

      const normalizedSubmissionId = submissionRow.id as string;

      let nextFiles = existingFiles;

      if (hasNewFiles) {
        const uploadedPaths: string[] = [];
        const uploadedRows: Array<{
          submission_id: string;
          file_name: string;
          file_url: string;
          storage_path: string;
          file_mime: string;
          file_size_bytes: number;
        }> = [];

        try {
          for (const file of selectedFiles) {
            const storagePath = `assignment-submissions/${assignment.id}/${enrollment.id}/${Date.now()}-${sanitizeFileName(file.name)}`;
            const uploadResult = await uploadFile(file, storagePath, 'assignment-files');

            if (uploadResult.error || !uploadResult.url) {
              throw new Error(uploadResult.error || `Failed to upload ${file.name}`);
            }

            uploadedPaths.push(storagePath);
            uploadedRows.push({
              submission_id: normalizedSubmissionId,
              file_name: file.name,
              file_url: uploadResult.url,
              storage_path: storagePath,
              file_mime: file.type,
              file_size_bytes: file.size,
            });
          }
        } catch (error) {
          if (uploadedPaths.length > 0) {
            await supabase.storage.from('assignment-files').remove(uploadedPaths);
          }
          throw error;
        }

        if (existingFiles.length > 0) {
          const existingPaths = existingFiles.map((file) => file.storage_path);
          await supabase.from('assignment_submission_files').delete().eq('submission_id', normalizedSubmissionId);
          if (existingPaths.length > 0) {
            await supabase.storage.from('assignment-files').remove(existingPaths);
          }
        }

        const { error: fileInsertError } = await supabase
          .from('assignment_submission_files')
          .insert(uploadedRows);

        if (fileInsertError) {
          throw fileInsertError;
        }

        nextFiles = uploadedRows.map((row, index) => ({
          id: `${normalizedSubmissionId}-${index}`,
          created_at: submittedAt,
          ...row,
        }));
      }

      setAssignment({
        ...assignment,
        submission_id: normalizedSubmissionId,
        submission_status: submissionRow.status,
        submitted_at: submissionRow.submitted_at,
        submission_text: submissionRow.submission_text,
        is_late: submissionRow.is_late,
      });
      setExistingFiles(nextFiles);
      setSelectedFiles([]);
      toast.success('Assignment submission saved.');
    } catch (error) {
      console.error('Error saving submission:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to submit assignment.');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !profile) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-brand-maroon border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading assignment...</p>
        </div>
      </div>
    );
  }

  if (!assignment || !course) {
    return null;
  }

  const isSocraticAssignment = assignment.experience_type === 'socratic_writing';

  return (
    <StudentLayout profile={profile}>
      <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
        <div>
          <button
            onClick={() => router.push(`/student/course/${courseId}`)}
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ArrowLeft className="w-5 h-5" />
            Back to Course
          </button>
          <div className="bg-card border border-border rounded-2xl p-6">
            <h1 className="text-3xl font-bold text-foreground">{assignment.assignment_label}</h1>
            <p className="text-lg text-muted-foreground mt-1">{assignment.assignment_title}</p>
            <p className="text-sm text-muted-foreground mt-2">
              {course.course_number ? `${course.course_number} - ` : ''}{course.title} • {course.instructor_name}
            </p>
          </div>
        </div>

        <section className="bg-card border border-border rounded-2xl p-6 space-y-4">
          <h2 className="text-xl font-semibold text-foreground">Assignment Overview</h2>
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div className="rounded-xl bg-muted/40 p-4">
              <p className="text-muted-foreground mb-1">Availability</p>
              <p className="font-semibold text-foreground">{formatAssignmentDate(assignment.available_at)}</p>
            </div>
            <div className="rounded-xl bg-muted/40 p-4">
              <p className="text-muted-foreground mb-1">Due Date</p>
              <p className="font-semibold text-foreground">{formatAssignmentDate(assignment.due_at)}</p>
            </div>
            <div className="rounded-xl bg-muted/40 p-4">
              <p className="text-muted-foreground mb-1">Late Until</p>
              <p className="font-semibold text-foreground">{formatAssignmentDate(assignment.late_until)}</p>
            </div>
            <div className="rounded-xl bg-muted/40 p-4">
              <p className="text-muted-foreground mb-1">Points Possible</p>
              <p className="font-semibold text-foreground">{assignment.points_possible}</p>
            </div>
          </div>

          <div>
            <h3 className="font-semibold text-foreground mb-2">Instructions</h3>
            <div className="rounded-xl border border-border p-4 text-sm text-foreground whitespace-pre-wrap min-h-[120px]">
              {assignment.description || 'No instructions provided.'}
            </div>
          </div>

          {assignment.question_pdf_url && (
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => window.open(assignment.question_pdf_url!, '_blank', 'noopener,noreferrer')}
                className="inline-flex items-center gap-2 border border-brand-maroon text-brand-maroon px-4 py-2 rounded-lg hover:bg-brand-maroon hover:text-white transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                Open Question PDF
              </button>
              <a
                href={assignment.question_pdf_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 border border-border text-foreground px-4 py-2 rounded-lg hover:bg-muted transition-colors"
              >
                <Download className="w-4 h-4" />
                Download PDF
              </a>
            </div>
          )}

          {isSocraticAssignment && (
            <div className="rounded-2xl border border-purple-200 bg-purple-50 px-4 py-4 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="font-semibold text-purple-950">Socratic Writing Studio</h3>
                <p className="text-sm text-purple-900/80 mt-1">
                  Continue the guided Clarify, Research, Build, and Write workflow. Submissions for this assignment are handled through the studio.
                </p>
              </div>
              <button
                onClick={() => router.push(`/student/course/${courseId}/assignment/${assignment.id}/studio`)}
                className="inline-flex items-center gap-2 rounded-lg border border-purple-300 bg-white px-4 py-2 font-semibold text-purple-700 hover:bg-purple-100 transition-colors"
              >
                <BookOpen className="w-4 h-4" />
                Launch Studio
              </button>
            </div>
          )}
        </section>

        <section className="bg-card border border-border rounded-2xl p-6 space-y-4">
          <h2 className="text-xl font-semibold text-foreground">Current Submission</h2>

          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div className="rounded-xl bg-muted/40 p-4">
              <p className="text-muted-foreground mb-1">Submission Status</p>
              <p className="font-semibold text-foreground capitalize">{assignment.submission_status || 'pending'}</p>
            </div>
            <div className="rounded-xl bg-muted/40 p-4">
              <p className="text-muted-foreground mb-1">Submitted At</p>
              <p className="font-semibold text-foreground">{formatAssignmentDate(assignment.submitted_at)}</p>
            </div>
            <div className="rounded-xl bg-muted/40 p-4">
              <p className="text-muted-foreground mb-1">Grade</p>
              <p className="font-semibold text-foreground">
                {assignment.grade_score !== null ? `${assignment.grade_score} / ${assignment.points_possible}` : 'Not graded yet'}
              </p>
            </div>
            <div className="rounded-xl bg-muted/40 p-4">
              <p className="text-muted-foreground mb-1">Late Submission</p>
              <p className="font-semibold text-foreground">{assignment.is_late ? 'Yes' : 'No'}</p>
            </div>
          </div>

          <div>
            <h3 className="font-semibold text-foreground mb-2">Educator Feedback</h3>
            <div className="rounded-xl border border-border p-4 text-sm text-foreground whitespace-pre-wrap min-h-[96px]">
              {assignment.feedback_text || 'No feedback yet.'}
            </div>
          </div>

          {existingFiles.length > 0 && (
            <div>
              <h3 className="font-semibold text-foreground mb-2">Saved Submission Files</h3>
              <div className="space-y-2">
                {existingFiles.map((file) => (
                  <div key={file.id} className="rounded-xl border border-border px-4 py-3 flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">{file.file_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {file.file_mime || 'Unknown type'} • {formatFileSizeLabel(file.file_size_bytes)}
                      </p>
                    </div>
                    <button
                      onClick={() => window.open(file.file_url, '_blank', 'noopener,noreferrer')}
                      className="inline-flex items-center gap-2 border border-border px-3 py-2 rounded-lg hover:bg-muted transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      Open
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="bg-card border border-border rounded-2xl p-6 space-y-4">
          <h2 className="text-xl font-semibold text-foreground">Submit or Resubmit Work</h2>

          {isSocraticAssignment ? (
            <div className="rounded-xl border border-purple-200 bg-purple-50 px-4 py-4 text-sm text-purple-900">
              Submit this assignment through <span className="font-semibold">Socratic Writing Studio</span>. The final essay, notebook, and ledger will sync back here automatically after submission.
            </div>
          ) : (
            <>
          {!canSubmit && (
            <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
              This assignment is currently closed for submissions.
            </div>
          )}

          {fileUploadsEnabled && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Submission Files
              </label>
              <label className="flex items-center justify-between gap-3 border border-border rounded-xl px-4 py-3 cursor-pointer hover:border-brand-maroon transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <Upload className="w-5 h-5 text-brand-maroon flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {pendingFilesLabel}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {assignment.max_files} file(s) max • {formatFileSizeLabel(assignment.max_file_size_bytes)} per file
                    </p>
                  </div>
                </div>
                <input
                  type="file"
                  className="hidden"
                  multiple={assignment.max_files !== 1}
                  onChange={handleFileSelection}
                  disabled={!canSubmit}
                />
              </label>

              {assignment.allowed_mime_types.length > 0 && (
                <p className="text-xs text-muted-foreground mt-2">
                  Allowed types: {assignment.allowed_mime_types.join(', ')}
                </p>
              )}

              {selectedFiles.length > 0 && (
                <div className="mt-3 space-y-2">
                  {selectedFiles.map((file) => (
                    <div key={`${file.name}-${file.size}`} className="rounded-lg bg-muted/40 px-3 py-2 text-sm text-foreground flex items-center gap-2">
                      <FileText className="w-4 h-4 text-brand-maroon" />
                      <span className="truncate">{file.name}</span>
                    </div>
                  ))}
                  {existingFiles.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Submitting these files will replace the currently saved files.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {textEntryEnabled && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Submission Notes
              </label>
              <textarea
                value={submissionText}
                onChange={(event) => setSubmissionText(event.target.value)}
                rows={6}
                disabled={!canSubmit}
                placeholder="Add any written response, notes, or explanation for your submission."
                className="w-full px-4 py-3 border border-border rounded-xl focus:ring-2 focus:ring-brand-maroon focus:border-transparent bg-background text-foreground resize-none"
              />
            </div>
          )}

          <button
            onClick={() => void handleSubmit()}
            disabled={!canSubmit || saving}
            className="inline-flex items-center gap-2 bg-brand-maroon hover:bg-brand-maroon-hover text-white font-semibold py-3 px-5 rounded-lg transition-colors disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving Submission...' : assignment.submitted_at ? 'Save Resubmission' : 'Submit Assignment'}
          </button>
            </>
          )}
        </section>
      </div>
    </StudentLayout>
  );
}
