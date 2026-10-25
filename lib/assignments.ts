export type AssignmentStatus = 'draft' | 'published' | 'closed' | 'archived';
export type AssignmentSubmissionMode = 'file_upload' | 'text_entry' | 'file_and_text';
export type StudentAssignmentCardStatus = 'pending' | 'submitted' | 'late' | 'graded' | 'closed';
export type AssignmentExperienceType = 'standard' | 'socratic_writing';

export type AssignmentRecord = {
  id: string;
  course_id: string;
  educator_id: string;
  assignment_number: number;
  assignment_label: string;
  assignment_title: string;
  description: string | null;
  question_file_name: string | null;
  question_pdf_url: string | null;
  question_storage_path: string | null;
  points_possible: number;
  status: AssignmentStatus;
  submission_mode: AssignmentSubmissionMode;
  experience_type: AssignmentExperienceType;
  allowed_mime_types: string[];
  max_file_size_bytes: number | null;
  max_files: number;
  available_at: string | null;
  due_at: string | null;
  late_until: string | null;
  created_at: string;
  updated_at: string;
};

export type StudentCourseAssignment = {
  id: string;
  course_id: string;
  assignment_number?: number;
  assignment_label: string;
  assignment_title: string;
  description: string | null;
  question_file_name: string | null;
  question_pdf_url: string | null;
  question_storage_path: string | null;
  points_possible: number;
  status: AssignmentStatus;
  submission_mode: AssignmentSubmissionMode;
  experience_type: AssignmentExperienceType;
  allowed_mime_types: string[];
  max_file_size_bytes: number | null;
  max_files: number;
  available_at: string | null;
  due_at: string | null;
  late_until: string | null;
  created_at: string;
  submission_id: string | null;
  submission_status: string | null;
  submitted_at: string | null;
  submission_text: string | null;
  is_late: boolean | null;
  grade_score: number | null;
  feedback_text: string | null;
  feedback_returned_at: string | null;
};

export type AssignmentSubmissionRecord = {
  id: string;
  assignment_id: string;
  course_student_id: string;
  student_id: string | null;
  submission_text: string | null;
  status: 'pending' | 'submitted' | 'late' | 'graded' | 'returned';
  submitted_at: string | null;
  updated_at: string;
  is_late: boolean;
  grade_score: number | null;
  feedback_text: string | null;
  feedback_returned_at: string | null;
  grader_id: string | null;
};

export type AssignmentSubmissionFile = {
  id: string;
  submission_id: string;
  file_name: string;
  file_url: string;
  storage_path: string;
  file_mime: string | null;
  file_size_bytes: number | null;
  created_at: string;
};

export const ASSIGNMENT_ALLOWED_FILE_TYPES = [
  { label: 'PDF', mime: 'application/pdf' },
  { label: 'Word (.doc)', mime: 'application/msword' },
  {
    label: 'Word (.docx)',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  { label: 'Text', mime: 'text/plain' },
  { label: 'JPEG', mime: 'image/jpeg' },
  { label: 'PNG', mime: 'image/png' },
] as const;

export const DEFAULT_ASSIGNMENT_ALLOWED_MIME_TYPES = ASSIGNMENT_ALLOWED_FILE_TYPES.map(
  (option) => option.mime,
);

export const formatAssignmentDate = (value: string | null) => {
  if (!value) return 'No date set';

  return new Date(value).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

export const formatFileSizeLabel = (bytes: number | null | undefined) => {
  if (!bytes || bytes <= 0) return 'No limit';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const sanitizeFileName = (fileName: string) =>
  fileName.replace(/[^a-zA-Z0-9._-]/g, '-');

export const canSubmitAssignment = (assignment: {
  status: AssignmentStatus;
  available_at: string | null;
  due_at: string | null;
  late_until: string | null;
}) => {
  const now = new Date();

  if (assignment.status !== 'published') return false;
  if (assignment.available_at && new Date(assignment.available_at) > now) return false;

  if (!assignment.due_at) return true;
  if (new Date(assignment.due_at) >= now) return true;

  if (assignment.late_until && new Date(assignment.late_until) >= now) return true;

  return false;
};

export const getStudentAssignmentCardStatus = (
  assignment: Pick<StudentCourseAssignment, 'status' | 'submitted_at' | 'submission_status' | 'is_late' | 'grade_score' | 'due_at' | 'late_until'>,
): StudentAssignmentCardStatus => {
  if (assignment.grade_score !== null || assignment.submission_status === 'graded') {
    return 'graded';
  }

  if (assignment.submitted_at) {
    return assignment.is_late ? 'late' : 'submitted';
  }

  if (!canSubmitAssignment({
    status: assignment.status,
    available_at: null,
    due_at: assignment.due_at,
    late_until: assignment.late_until,
  })) {
    return 'closed';
  }

  return 'pending';
};
